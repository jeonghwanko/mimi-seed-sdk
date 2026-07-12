import kleur from "kleur";
import { getEffectiveConfig } from "./config.js";
import { catalog } from "./i18n.js";
import { mcpCall } from "./mcp-client.js";

// 이 명령 전용 문구. 공통 문구(setup/doctor/auth)는 i18n.ts 의 `t()` 에 있다.
const M = catalog(
  {
    noAccount: "연결된 계정 없음. `mimi-seed init` 실행.\n",
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

interface CheckArgs {
  appId?: string;
  failOnBlocker: boolean;
}

function parseArgs(argv: string[]): CheckArgs {
  const args: CheckArgs = { failOnBlocker: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--app" && argv[i + 1]) args.appId = argv[++i];
    if (argv[i] === "--fail-on-blocker") args.failOnBlocker = true;
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
  const args = parseArgs(argv);
  const cfg = await getEffectiveConfig();

  if (!cfg) {
    process.stdout.write(kleur.red(M().noAccount));
    process.exit(1);
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
