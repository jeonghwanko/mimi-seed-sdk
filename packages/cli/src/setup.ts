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
  if (d.present) mark = kleur.green("✓");
  else if (isSatisfied(spec, detected)) mark = kleur.yellow("~"); // fallback 으로 동작은 함
  else if (spec.requirement === "optional" || !relevant) mark = kleur.dim("·");
  else mark = kleur.red("✗");

  const tail = d.present
    ? kleur.dim(d.detail ?? "")
    : isSatisfied(spec, detected)
      ? kleur.dim(`${spec.note ?? "폴백으로 동작 중"}`)
      : kleur.dim(`→ ${spec.fix}`);

  return `  ${mark} ${spec.label.padEnd(24)} ${tail}`;
}

function printStatus(detected: Map<CredId, Detected>, platforms: Platform[]): void {
  log(kleur.bold("연결 상태  ") + kleur.dim("(~/.mimi-seed)"));
  log();
  for (const group of ["core", "ci", "marketing"] as const) {
    const specs = CREDENTIALS.filter((c) => c.group === group);
    const title = group === "core" ? "핵심" : group === "ci" ? "빌드 / CI" : "마케팅 · AI";
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
    rl.question(q, (a) => {
      rl.close();
      resolve(a.trim());
    });
    // stdin 이 EOF 면 question 콜백이 영원히 안 온다 — 조용히 멈추는 대신 빈 답으로 진행한다.
    rl.on('close', () => resolve(''));
  });
}

function printObtain(spec: CredSpec): void {
  log();
  log(kleur.bold(`  ${spec.label} — 미리 준비할 것`));
  for (const line of spec.obtain) log(kleur.dim(`    ${line}`));
  if (spec.docsAnchor) {
    log(kleur.dim(`    자세히: docs/credentials.md#${spec.docsAnchor}`));
  }
  log();
}

/** 한 자격증명 연결. true = 연결 시도함(성공/실패 무관), false = 건너뜀. */
async function connectOne(spec: CredSpec): Promise<boolean> {
  switch (spec.setup.kind) {
    case "mcp-bin": {
      const code = await runMcpBin(spec.setup.bin, spec.setup.args ?? []);
      if (code !== 0) {
        // 한 개가 실패해도 마법사 전체를 중단하지 않는다 — 나머지는 계속 연결할 수 있어야 한다.
        log(kleur.yellow(`  ⚠ ${spec.label} 설정이 완료되지 않았어 (exit ${code}). 나중에 다시: ${spec.fix}`));
      }
      return true;
    }
    case "cli": {
      const provider = spec.setup.handler;
      const cfg = await promptGitProviderSetup(provider);
      log(kleur.dim("  🔎 토큰 검증 중..."));
      const check = await verifyCiToken(cfg);
      if (!check.ok) {
        log(kleur.red(`  ❌ 토큰 검증 실패: ${check.reason}`));
        log(kleur.dim(`     저장하지 않았어. 다시: ${spec.fix}`));
        return true;
      }
      saveCiProviderConfig(cfg);
      log(kleur.green(`  ✅ ${spec.label} 연결됨${check.login ? ` (${check.login})` : ""} → ~/.mimi-seed/ci.json`));
      return true;
    }
    case "command": {
      // init 은 자체 브라우저 핸드셰이크가 필요하다 — 여기서 대신 실행하지 않고 안내만.
      log(kleur.yellow(`  이건 별도 명령으로 실행해줘:  ${kleur.cyan(spec.setup.run)}`));
      await ask(kleur.dim("  (엔터를 누르면 계속) "));
      return true;
    }
    case "env": {
      log(kleur.yellow(`  환경변수로 설정하는 항목이야:`));
      log(kleur.cyan(`    export ${spec.setup.envVar}=...`));
      log(kleur.dim(`    (Windows PowerShell:  $env:${spec.setup.envVar} = "..." )`));
      await ask(kleur.dim("  (엔터를 누르면 계속) "));
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

  const hints = await detectHints(process.cwd());
  const platforms: Platform[] =
    opts.platforms ??
    ([
      hints.some((h) => h.packageName) ? "android" : null,
      hints.some((h) => h.bundleId) ? "ios" : null,
    ].filter(Boolean) as Platform[]);

  log(kleur.bold("mimi-seed setup"));
  if (platforms.length > 0) log(kleur.dim(`  감지된 플랫폼: ${platforms.join(", ")}`));
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
      log(kleur.yellow("  필수 항목 누락:"));
      for (const spec of missing) log(kleur.yellow(`    • ${spec.label} → ${spec.fix}`));
      log();
    }

    // 특정 자격증명을 콕 집어 요청했는데(예: `mimi-seed auth ci`) 비대화라 못 해준 경우,
    // 조용히 성공(exit 0)하면 `mimi-seed auth ci && mimi-seed deploy` 같은 스크립트가
    // 설정 없이 그대로 진행해버린다. 명확히 실패시킨다.
    if (opts.only && plan.length > 0) {
      log(kleur.red("  ✗ 이 자격증명은 대화형 입력이 필요해서 여기서는 설정할 수 없어:"));
      for (const spec of plan) log(kleur.red(`    • ${spec.label}`));
      log(kleur.dim("    터미널에서 실행해줘 (Git Bash 등 TTY 미감지 환경이면 --interactive)."));
      process.exit(1);
    }

    log(kleur.dim("  대화형으로 연결하려면 터미널에서:  mimi-seed setup"));
    if (opts.failOnMissing && missing.length > 0) process.exit(1);
    return;
  }

  if (plan.length === 0) {
    // "연결할 게 없다"는 요청 범위 안에서의 이야기다 — --only 로 좁혔다면 그렇게 말해야 한다.
    if (opts.only) {
      log(kleur.green("  ✅ 요청한 항목은 이미 연결돼 있어."));
      log(kleur.dim("     다시 설정하려면: mimi-seed setup --reconnect <id>"));
    } else {
      log(kleur.green("  ✅ 연결할 게 더 없어. 다 됐다."));
    }
    log(kleur.dim("     점검: mimi-seed doctor"));
    // 여기서 그냥 return 하면 --fail-on-missing 이 무시된다 (--only 오타로 plan 이 빌 수도 있다).
    if (opts.failOnMissing && missingRequired(detected, platforms).length > 0) process.exit(1);
    return;
  }

  log(kleur.dim(`  ${plan.length}개 항목을 순서대로 물어볼게. 언제든 s=건너뛰기, q=종료.`));
  log();

  let aborted = false;
  for (const spec of plan) {
    if (aborted) break;
    const req =
      spec.requirement === "optional"
        ? kleur.dim("(선택)")
        : spec.requirement === "platform"
          ? kleur.dim(`(${spec.platform} 배포에 필요)`)
          : kleur.red("(필수)");

    // 한 항목당 루프 — '?' 는 단계를 소비하지 않는다.
    for (;;) {
      log(kleur.bold(`▸ ${spec.label} ${req}`));
      if (spec.note) log(kleur.dim(`  ${spec.note}`));
      const answer = (
        await ask("  [c] 연결  [s] 건너뛰기  [?] 이건 어떻게 구하나요  [q] 종료 : ")
      ).toLowerCase();

      if (answer === "?" || answer === "h") {
        printObtain(spec);
        continue;
      }
      if (answer === "q") {
        log();
        log(kleur.dim("  중단했어. 이어서 하려면 다시:  mimi-seed setup"));
        aborted = true;
        break;
      }
      if (answer === "s" || answer === "") {
        log(kleur.dim(`  건너뜀. 나중에: ${spec.fix}`));
        log();
        break;
      }
      if (answer === "c") {
        await connectOne(spec);
        log();
        break;
      }
      log(kleur.dim("  c / s / ? / q 중에서 골라줘."));
    }
  }

  // 최종 상태 재감지
  detected = detectAll(home);
  log();
  printStatus(detected, platforms);

  const stillMissing = missingRequired(detected, platforms);
  if (stillMissing.length === 0) {
    log(kleur.green("  ✅ 필수 연결 완료."));
  } else {
    log(kleur.yellow("  아직 필수 항목이 남아 있어:"));
    for (const spec of stillMissing) log(kleur.yellow(`    • ${spec.label} → ${spec.fix}`));
  }
  log(kleur.dim("     점검: mimi-seed doctor   ·   배포: mimi-seed deploy"));
  log();

  if (opts.failOnMissing && stillMissing.length > 0) process.exit(1);
}
