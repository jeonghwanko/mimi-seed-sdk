import kleur from "kleur";
import { getEffectiveConfig } from "./config.js";
import { catalog } from "./i18n.js";
import { mcpCall } from "./mcp-client.js";
import { runMcpBin } from "./mcp-bin.js";

// 이 명령 전용 문구. 공통 문구(setup/doctor/auth)는 i18n.ts 의 `t()` 에 있다.
const M = catalog(
  {
    noAccount: "연결된 계정 없음. `mimi-seed init` 실행.\n",
    missingOptionValue: (option: string) => `${option} 뒤에 값을 입력하세요.`,
    unknownOption: (option: string) => `알 수 없는 check 옵션: ${option}`,
    unexpectedArgument: (value: string) => `예상하지 않은 check 인자: ${value}`,
    localAppConflict: "--app은 원격 검사 전용이므로 --local, --path, --json과 함께 사용할 수 없습니다.\n",
    localStarting: "Release Doctor 실행 중… 첫 실행은 검사기 다운로드로 시간이 걸릴 수 있습니다.\n",
    title: "mimi-seed check — 출시 전 점검\n\n",
    appsFailed: (msg: string) => `앱 목록 조회 실패: ${msg}\n`,
    noApps: "등록된 앱이 없습니다. `mimi-seed init` 후 앱을 등록하세요.\n",
    app: (name: string) => `앱: ${name}\n\n`,
    appsParseFailed: (raw: string) => `앱 목록 파싱 실패: ${raw}\n`,
    scoring: "📊 Readiness 점수 계산 중...\n",
    scoreFailed: (msg: string) => `점수 조회 실패: ${msg}\n`,
    score: (bar: string) => `\n점수: ${bar}\n\n`,
    byModule: "── 모듈별 ──\n",
    blockers: "🚫 블로커:\n",
    warnings: "⚠ 경고:\n",
    stepIntegration: (url: string) => `연결 진단    ${url}`,
    stepCopy: (url: string) => `문구 보강    mimi-seed notes  또는  ${url}`,
    stepScreenshot: (url: string) => `스크린샷     ${url}`,
    stepChecklist: (url: string) => `체크리스트   ${url}`,
    nextSteps: "→ 다음 단계:\n",
    preview: "  미리보기: mimi-seed deploy --dry-run\n\n",
    ready: "✓ 출시 준비 완료!\n",
    notReady: (score: number) => `아직 ${score}/100 — 위 다음 단계를 진행하세요.\n`,
  },
  {
    noAccount: "No account connected. Run `mimi-seed init`.\n",
    missingOptionValue: (option: string) => `Provide a value after ${option}.`,
    unknownOption: (option: string) => `Unknown check option: ${option}`,
    unexpectedArgument: (value: string) => `Unexpected check argument: ${value}`,
    localAppConflict: "--app is remote-only and cannot be combined with --local, --path, or --json.\n",
    localStarting: "Running Release Doctor… the first run may take longer while the checker downloads.\n",
    title: "mimi-seed check — pre-launch check\n\n",
    appsFailed: (msg: string) => `Failed to list apps: ${msg}\n`,
    noApps: "No apps registered. Run `mimi-seed init`, then register an app.\n",
    app: (name: string) => `App: ${name}\n\n`,
    appsParseFailed: (raw: string) => `Failed to parse the app list: ${raw}\n`,
    scoring: "📊 Computing the readiness score...\n",
    scoreFailed: (msg: string) => `Failed to fetch the score: ${msg}\n`,
    score: (bar: string) => `\nScore: ${bar}\n\n`,
    byModule: "── By module ──\n",
    blockers: "🚫 Blockers:\n",
    warnings: "⚠ Warnings:\n",
    stepIntegration: (url: string) => `Connections   ${url}`,
    stepCopy: (url: string) => `Copy          mimi-seed notes  or  ${url}`,
    stepScreenshot: (url: string) => `Screenshots   ${url}`,
    stepChecklist: (url: string) => `Checklist     ${url}`,
    nextSteps: "→ Next steps:\n",
    preview: "  Preview: mimi-seed deploy --dry-run\n\n",
    ready: "✓ Ready to launch!\n",
    notReady: (score: number) => `Still ${score}/100 — work through the next steps above.\n`,
  },
);

export interface CheckArgs {
  appId?: string;
  projectPath: string;
  projectPathExplicit: boolean;
  failOnBlocker: boolean;
  local: boolean;
  json: boolean;
}

export function parseCheckArgs(argv: string[]): CheckArgs {
  const args: CheckArgs = {
    projectPath: process.cwd(),
    projectPathExplicit: false,
    failOnBlocker: false,
    local: false,
    json: false,
  };
  const takeValue = (option: string, index: number): string => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(M().missingOptionValue(option));
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--app") args.appId = takeValue(token, i++);
    else if (token === "--path") {
      args.projectPath = takeValue(token, i++);
      args.projectPathExplicit = true;
    } else if (token === "--fail-on-blocker") args.failOnBlocker = true;
    else if (token === "--local") args.local = true;
    else if (token === "--json") args.json = true;
    else if (token.startsWith("-")) throw new Error(M().unknownOption(token));
    else throw new Error(M().unexpectedArgument(token));
  }
  return args;
}

function renderScore(score: number): string {
  const filled = Math.round(score / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  const color = score >= 80 ? kleur.green : score >= 50 ? kleur.yellow : kleur.red;
  return color(`${bar} ${score}/100`);
}

const MODULE_LABELS: Record<string, string> = {
  integration: "Integration",
  copy:        "Copy Studio",
  screenshot:  "Screenshot",
  checklist:   "Checklist",
};

export async function cmdCheck(argv: string[]): Promise<void> {
  let args: CheckArgs;
  try {
    args = parseCheckArgs(argv);
  } catch (error) {
    process.stderr.write(kleur.red(`${error instanceof Error ? error.message : String(error)}\n`));
    process.exitCode = 2;
    return;
  }
  const cfg = await getEffectiveConfig();

  // The free acquisition path must produce value before asking for credentials. Existing connected
  // users retain the richer remote readiness score; --local always forces repository-only checks.
  const localRequested = args.local || args.json || args.projectPathExplicit;
  if (args.appId && localRequested) {
    process.stderr.write(kleur.red(M().localAppConflict));
    process.exitCode = 2;
    return;
  }
  if (args.appId && !cfg) {
    process.stderr.write(kleur.red(M().noAccount));
    process.exitCode = 1;
    return;
  }
  if (localRequested || !cfg) {
    const doctorArgs = [args.projectPath];
    if (args.json) doctorArgs.push("--json");
    if (args.failOnBlocker) doctorArgs.push("--fail-on-blocker");
    if (!args.json) process.stderr.write(kleur.dim(M().localStarting));
    const exitCode = await runMcpBin("mimi-seed-release-doctor", doctorArgs);
    if (exitCode !== 0) process.exit(exitCode);
    return;
  }

  process.stdout.write(kleur.bold(M().title));

  const appsResult = await mcpCall(cfg.endpoint, cfg.token, "list_apps", {});
  if (appsResult.isError) {
    process.stdout.write(kleur.red(M().appsFailed(appsResult.text)));
    process.exit(1);
  }

  let appId = args.appId;
  if (!appId) {
    try {
      const apps = JSON.parse(appsResult.text);
      if (!Array.isArray(apps) || apps.length === 0) {
        process.stdout.write(kleur.yellow(M().noApps));
        process.exit(0);
      }
      appId = apps[0].id as string;
      process.stdout.write(kleur.dim(M().app(apps[0].name ?? appId)));
    } catch {
      process.stdout.write(kleur.red(M().appsParseFailed(appsResult.text.slice(0, 80))));
      process.exit(1);
    }
  }

  process.stdout.write(M().scoring);
  const readinessResult = await mcpCall(cfg.endpoint, cfg.token, "get_readiness", { app_id: appId });

  if (readinessResult.isError) {
    process.stdout.write(kleur.red(M().scoreFailed(readinessResult.text)));
    process.exit(1);
  }

  let hasBlocker = false;
  try {
    const data = JSON.parse(readinessResult.text) as {
      score?: number;
      modules?: Record<string, number>;
      blockers?: string[];
      warnings?: string[];
    };
    const score = data.score ?? 0;
    process.stdout.write(M().score(renderScore(score)));

    if (data.modules) {
      process.stdout.write(kleur.dim(M().byModule));
      for (const [key, val] of Object.entries(data.modules)) {
        const label = MODULE_LABELS[key] ?? key;
        const color = val >= 25 ? kleur.green : val >= 10 ? kleur.yellow : kleur.red;
        process.stdout.write(`  ${label.padEnd(12)} ${color(String(val).padStart(2))}/25\n`);
      }
      process.stdout.write("\n");
    }

    if (data.blockers?.length) {
      hasBlocker = true;
      process.stdout.write(kleur.bold(M().blockers));
      for (const b of data.blockers) process.stdout.write(`  ${kleur.red("•")} ${b}\n`);
      process.stdout.write("\n");
    }

    if (data.warnings?.length) {
      process.stdout.write(kleur.bold(M().warnings));
      for (const w of data.warnings) process.stdout.write(`  ${kleur.yellow("•")} ${w}\n`);
      process.stdout.write("\n");
    }

    // 모듈 약점 → 구체적 다음 액션 (doctor 처럼 막다른 길이 아니라 명령/링크 제시)
    const base = `${cfg.webBase}/apps/${appId}`;
    const nextSteps: string[] = [];
    if (data.modules) {
      if ((data.modules.integration ?? 25) < 25) nextSteps.push(M().stepIntegration(`${base}/integration`));
      if ((data.modules.copy ?? 25) < 25) nextSteps.push(M().stepCopy(`${base}/copy`));
      if ((data.modules.screenshot ?? 25) < 25) nextSteps.push(M().stepScreenshot(`${base}/screenshots`));
      if ((data.modules.checklist ?? 25) < 25) nextSteps.push(M().stepChecklist(`${base}/launch`));
    }
    if (nextSteps.length) {
      process.stdout.write(kleur.bold(M().nextSteps));
      for (const s of nextSteps) process.stdout.write(`  ${kleur.cyan("•")} ${s}\n`);
      process.stdout.write(kleur.dim(M().preview));
    }

    if (!hasBlocker) {
      process.stdout.write(score >= 80 ? kleur.green(M().ready) : kleur.yellow(M().notReady(score)));
    }
  } catch {
    for (const line of readinessResult.text.split("\n")) process.stdout.write("  " + line + "\n");
  }

  if (hasBlocker && args.failOnBlocker) process.exit(1);
}
