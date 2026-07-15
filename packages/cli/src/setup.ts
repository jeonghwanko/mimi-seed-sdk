// `mimi-seed setup` — 가진 계정을 한 번에 연결하는 대화형 마법사.
//
// 설계 메모 2가지:
//  1. 자격증명 목록은 여기 없다. credentials.ts 레지스트리가 SSOT 다 (doctor/auth status 와 공유).
//  2. **비대화 환경에서는 아무것도 spawn 하지 않는다.** setup bin 들은 blocking readline 이라
//     CI 에서 띄우면 영원히 멈춘다. resolveMode() 가 그 문을 지킨다.

import kleur from "kleur";
import * as readline from "node:readline";
import os from "node:os";
import {
  CREDENTIALS,
  credLabel,
  credNote,
  credObtain,
  detectAll,
  isSatisfied,
  missingRequired,
  planSetup,
  type CredId,
  type CredSpec,
  type Detected,
  type Platform,
} from "./credentials.js";
import { runMcpBin } from "./mcp-bin.js";
import { migrateLegacyJenkins } from "./jenkins-config.js";
import { detectHints } from "./detect.js";
import { promptGitProviderSetup } from "./deploy.js";
import { saveCiProviderConfig, verifyCiToken } from "./ci-providers.js";
import { t } from "./i18n.js";
import { isLangUnset, writeSettings, type Lang } from "./settings.js";

function log(msg = ""): void {
  process.stdout.write(msg + "\n");
}

// ── 인자 파싱 ──

export interface SetupOpts {
  yes: boolean;
  nonInteractive: boolean;
  /** TTY 자동 감지를 무시하고 대화형 강제 (Git Bash/mintty 는 isTTY 를 false 로 보고한다). */
  interactive: boolean;
  only?: CredId[];
  reconnect?: CredId[];
  platforms?: Platform[];
  failOnMissing: boolean;
}

const ALL_IDS = new Set<string>(CREDENTIALS.map((c) => c.id));

function parseIds(raw: string): CredId[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ALL_IDS.has(s)) as CredId[];
}

export function parseSetupArgs(argv: string[]): SetupOpts {
  const opts: SetupOpts = {
    yes: false,
    nonInteractive: false,
    interactive: false,
    failOnMissing: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--non-interactive") opts.nonInteractive = true;
    else if (a === "--interactive") opts.interactive = true;
    else if (a === "--fail-on-missing") opts.failOnMissing = true;
    else if (a === "--only" && argv[i + 1]) opts.only = parseIds(argv[++i]);
    else if (a === "--reconnect" && argv[i + 1]) opts.reconnect = parseIds(argv[++i]);
    else if (a === "--platform" && argv[i + 1]) {
      opts.platforms = argv[++i]
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is Platform => s === "android" || s === "ios");
    }
  }
  return opts;
}

export type Mode = "interactive" | "report-only";

/**
 * 비대화로 판정되면 **프롬프트도 spawn 도 하지 않는다** — 상태표만 찍고 끝낸다.
 * setup bin 은 stdin 을 기다리는 대화형이라, CI 에서 띄우면 잡이 타임아웃까지 매달린다.
 *
 * 판정 기준은 **stdin** 이다 (stdout 이 아니라). 우리가 읽는 게 stdin 이고, `echo | mimi-seed setup`
 * 처럼 stdout 만 TTY 인 경우 대화형으로 들어가면 EOF 된 stdin 에서 조용히 멈춘다.
 * 다만 Git Bash/mintty 는 실제 터미널인데도 isTTY 를 false 로 보고하므로 `--interactive` 로 강제할 수 있다.
 */
export function resolveMode(
  opts: SetupOpts,
  env: NodeJS.ProcessEnv,
  stdinIsTTY: boolean | undefined,
): Mode {
  if (opts.nonInteractive || opts.yes) return "report-only";
  if (opts.interactive) return "interactive"; // 명시적 강제가 TTY 감지를 이긴다
  if (env.CI) return "report-only";
  if (!stdinIsTTY) return "report-only";
  return "interactive";
}

// ── 상태표 ──

function statusLine(spec: CredSpec, detected: Map<CredId, Detected>, platforms: Platform[]): string {
  const d = detected.get(spec.id)!;
  const relevant =
    spec.requirement !== "platform" || platforms.length === 0 || platforms.includes(spec.platform!);

  let mark: string;
  if (d.freshness === "expired") mark = kleur.red("✗");
  else if (d.freshness === "expiring") mark = kleur.yellow("!");
  else if (d.present) mark = kleur.green("✓");
  else if (isSatisfied(spec, detected)) mark = kleur.yellow("~"); // fallback 으로 동작은 함
  else if (spec.requirement === "optional" || !relevant) mark = kleur.dim("·");
  else mark = kleur.red("✗");

  const tail = d.freshness === "expired"
    ? kleur.red(`${t().setup.tokenExpired} → ${spec.fix}`)
    : d.freshness === "expiring"
      ? kleur.yellow(`${t().setup.tokenExpiring(d.daysRemaining ?? 0)} → ${spec.fix}`)
    : d.present
      ? kleur.dim(d.detail ?? "")
    : isSatisfied(spec, detected)
      ? kleur.dim(`${credNote(spec) ?? t().setup.fallbackWorking}`)
      : kleur.dim(`→ ${spec.fix}`);

  return `  ${mark} ${credLabel(spec).padEnd(24)} ${tail}`;
}

function printStatus(detected: Map<CredId, Detected>, platforms: Platform[]): void {
  const m = t().setup;
  log(kleur.bold(m.statusTitle + "  ") + kleur.dim(m.statusDir));
  log();
  for (const group of ["core", "ci", "marketing"] as const) {
    const specs = CREDENTIALS.filter((c) => c.group === group);
    const title =
      group === "core" ? m.groupCore : group === "ci" ? m.groupCi : m.groupMarketing;
    log(kleur.dim(`  ── ${title} ──`));
    for (const spec of specs) log(statusLine(spec, detected, platforms));
    log();
  }
}

// ── 대화형 루프 ──

/**
 * 프롬프트마다 readline 을 **새로 열고 즉시 닫는다.**
 *
 * 오래 살아있는 readline 을 들고 있으면 안 된다: 연결 단계에서 setup bin 을 spawn 하는데
 * (stdio: inherit) 자식도 같은 stdin(fd 0)을 readline 으로 읽는다. 부모의 readline 이 살아
 * 있으면 두 리더가 같은 TTY 를 두고 경쟁해서 키 입력이 부모에게 먹히거나 이중 에코된다.
 * promptGitProviderSetup 도 자기 readline 을 따로 열기 때문에 같은 문제가 생긴다.
 */
function ask(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    // ⚠️ `rl.close()` 는 'close' 이벤트를 **동기적으로** 발화시킨다. 답변 콜백에서 close 를 먼저
    // 부르고 resolve 를 나중에 부르면, close 리스너의 resolve('') 가 promise 를 **먼저** 확정해
    // 버려서 모든 프롬프트가 빈 문자열을 반환한다 — 마법사가 사용자의 답을 무시하고 전부
    // "건너뛰기" 로 처리한다. 먼저 이긴 쪽 하나만 확정되도록 잠근다.
    let done = false;
    const finish = (value: string) => {
      if (done) return;
      done = true;
      rl.close();
      resolve(value);
    };
    rl.question(q, (a) => finish(a.trim()));
    // stdin 이 EOF 면 question 콜백이 영원히 안 온다 — 조용히 멈추는 대신 빈 답으로 진행한다.
    rl.on('close', () => finish(''));
  });
}

function printObtain(spec: CredSpec): void {
  log();
  log(kleur.bold(t().setup.obtainTitle(credLabel(spec))));
  for (const line of credObtain(spec)) log(kleur.dim(`    ${line}`));
  if (spec.docsAnchor) {
    log(kleur.dim(t().setup.obtainMore(spec.docsAnchor)));
  }
  log();
}

/**
 * 첫 실행이면 언어부터 묻는다 (기본 한국어).
 *
 * 언어를 먼저 정해야 이 뒤의 모든 출력 — 그리고 마법사가 spawn 하는 setup bin 들 — 이
 * 같은 언어로 나온다. 이미 정해져 있거나 비대화 모드면 묻지 않는다.
 */
async function ensureLangChosen(): Promise<void> {
  if (!isLangUnset()) return;
  const answer = await ask(t().lang.ask);
  const lang: Lang = answer.trim() === "2" || answer.trim().toLowerCase() === "en" ? "en" : "ko";
  writeSettings({ lang });
  process.env.MIMI_SEED_LANG = lang; // 이번 프로세스 + spawn 될 자식들에 즉시 반영
  log(kleur.green(t().lang.saved(lang)));
  log();
}

/** 한 자격증명 연결. true = 연결 시도함(성공/실패 무관), false = 건너뜀. */
async function connectOne(spec: CredSpec): Promise<boolean> {
  switch (spec.setup.kind) {
    case "mcp-bin": {
      const code = await runMcpBin(spec.setup.bin, spec.setup.args ?? []);
      if (code !== 0) {
        // 한 개가 실패해도 마법사 전체를 중단하지 않는다 — 나머지는 계속 연결할 수 있어야 한다.
        log(kleur.yellow(t().setup.binFailed(credLabel(spec), code, spec.fix)));
      }
      return true;
    }
    case "cli": {
      const provider = spec.setup.handler;
      const cfg = await promptGitProviderSetup(provider);
      log(kleur.dim(t().setup.verifying));
      const check = await verifyCiToken(cfg);
      if (!check.ok) {
        log(kleur.red(t().setup.verifyFailed(check.reason ?? "")));
        log(kleur.dim(t().setup.notSaved(spec.fix)));
        return true;
      }
      saveCiProviderConfig(cfg);
      log(kleur.green(t().setup.ciSaved(credLabel(spec), check.login ? ` (${check.login})` : "")));
      return true;
    }
    case "command": {
      // init 은 자체 브라우저 핸드셰이크가 필요하다 — 여기서 대신 실행하지 않고 안내만.
      log(kleur.yellow(t().setup.runSeparately(kleur.cyan(spec.setup.run))));
      await ask(kleur.dim(t().setup.pressEnter));
      return true;
    }
    case "env": {
      log(kleur.yellow(t().setup.envVar));
      log(kleur.cyan(`    export ${spec.setup.envVar}=...`));
      log(kleur.dim(`    (Windows PowerShell:  $env:${spec.setup.envVar} = "..." )`));
      await ask(kleur.dim(t().setup.pressEnter));
      return true;
    }
  }
}

// ── 메인 ──

export async function cmdSetup(argv: string[]): Promise<void> {
  const opts = parseSetupArgs(argv);
  const home = os.homedir();

  // 레거시 config.json.jenkins 가 남아 있으면 jenkins.json 으로 이관 (1회성, 조용히).
  migrateLegacyJenkins(home);

  // 첫 실행이면 언어부터. 대화형일 때만 묻는다 (비대화면 기본 ko / 환경변수).
  if (resolveMode(opts, process.env, process.stdin.isTTY) === "interactive") {
    await ensureLangChosen();
  }

  const hints = await detectHints(process.cwd());
  const platforms: Platform[] =
    opts.platforms ??
    ([
      hints.some((h) => h.packageName) ? "android" : null,
      hints.some((h) => h.bundleId) ? "ios" : null,
    ].filter(Boolean) as Platform[]);

  log(kleur.bold(t().setup.title));
  if (platforms.length > 0) log(kleur.dim(t().setup.platformsDetected(platforms.join(", "))));
  log();

  let detected = detectAll(home);
  printStatus(detected, platforms);

  const mode = resolveMode(opts, process.env, process.stdin.isTTY);
  const plan = planSetup(detected, {
    only: opts.only,
    reconnect: opts.reconnect,
    platforms,
  });

  if (mode === "report-only") {
    // 비대화: 절대 spawn/prompt 하지 않는다.
    const missing = missingRequired(detected, platforms);
    if (missing.length > 0) {
      log(kleur.yellow(t().setup.missingRequired));
      for (const spec of missing) log(kleur.yellow(`    • ${credLabel(spec)} → ${spec.fix}`));
      log();
    }

    // 특정 자격증명을 콕 집어 요청했는데(예: `mimi-seed auth ci`) 비대화라 못 해준 경우,
    // 조용히 성공(exit 0)하면 `mimi-seed auth ci && mimi-seed deploy` 같은 스크립트가
    // 설정 없이 그대로 진행해버린다. 명확히 실패시킨다.
    if (opts.only && plan.length > 0) {
      log(kleur.red(t().setup.cannotInteract));
      for (const spec of plan) log(kleur.red(`    • ${credLabel(spec)}`));
      log(kleur.dim(t().setup.cannotInteractHint));
      process.exit(1);
    }

    log(kleur.dim(t().setup.runInTerminal));
    if (opts.failOnMissing && missing.length > 0) process.exit(1);
    return;
  }

  if (plan.length === 0) {
    // "연결할 게 없다"는 요청 범위 안에서의 이야기다 — --only 로 좁혔다면 그렇게 말해야 한다.
    if (opts.only) {
      log(kleur.green(t().setup.onlyAlreadyDone));
      log(kleur.dim(t().setup.onlyReconnectHint));
    } else {
      log(kleur.green(t().setup.allDone));
    }
    log(kleur.dim("     " + t().common.checkWith));
    // 여기서 그냥 return 하면 --fail-on-missing 이 무시된다 (--only 오타로 plan 이 빌 수도 있다).
    if (opts.failOnMissing && missingRequired(detected, platforms).length > 0) process.exit(1);
    return;
  }

  log(kleur.dim(t().setup.planCount(plan.length)));
  log();

  let aborted = false;
  for (const spec of plan) {
    if (aborted) break;
    const req =
      spec.requirement === "optional"
        ? kleur.dim(`(${t().common.optional})`)
        : spec.requirement === "platform"
          ? kleur.dim(t().setup.neededFor(spec.platform!))
          : kleur.red(`(${t().common.required})`);

    // 한 항목당 루프 — '?' 는 단계를 소비하지 않는다.
    for (;;) {
      log(kleur.bold(`▸ ${credLabel(spec)} ${req}`));
      const note = credNote(spec);
      if (note) log(kleur.dim(`  ${note}`));
      const answer = (
        await ask(t().setup.prompt)
      ).toLowerCase();

      if (answer === "?" || answer === "h") {
        printObtain(spec);
        continue;
      }
      if (answer === "q") {
        log();
        log(kleur.dim(t().setup.quit));
        aborted = true;
        break;
      }
      if (answer === "s" || answer === "") {
        log(kleur.dim(t().setup.skipped(spec.fix)));
        log();
        break;
      }
      if (answer === "c") {
        await connectOne(spec);
        log();
        break;
      }
      log(kleur.dim(t().setup.promptInvalid));
    }
  }

  // 최종 상태 재감지
  detected = detectAll(home);
  log();
  printStatus(detected, platforms);

  const stillMissing = missingRequired(detected, platforms);
  if (stillMissing.length === 0) {
    log(kleur.green(t().setup.requiredDone));
  } else {
    log(kleur.yellow(t().setup.stillMissing));
    for (const spec of stillMissing) log(kleur.yellow(`    • ${credLabel(spec)} → ${spec.fix}`));
  }
  log(kleur.dim(t().setup.nextSteps));
  log();

  if (opts.failOnMissing && stillMissing.length > 0) process.exit(1);
}
