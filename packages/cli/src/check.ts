import kleur from "kleur";
import { getEffectiveConfig } from "./config.js";
import { mcpCall } from "./mcp-client.js";

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
    process.stdout.write(kleur.red("연결된 계정 없음. `mimi-seed init` 실행.\n"));
    process.exit(1);
  }

  process.stdout.write(kleur.bold("mimi-seed check — 출시 전 점검\n\n"));

  const appsResult = await mcpCall(cfg.endpoint, cfg.token, "list_apps", {});
  if (appsResult.isError) {
    process.stdout.write(kleur.red(`앱 목록 조회 실패: ${appsResult.text}\n`));
    process.exit(1);
  }

  let appId = args.appId;
  if (!appId) {
    try {
      const apps = JSON.parse(appsResult.text);
      if (!Array.isArray(apps) || apps.length === 0) {
        process.stdout.write(kleur.yellow("등록된 앱이 없습니다. `mimi-seed init` 후 앱을 등록하세요.\n"));
        process.exit(0);
      }
      appId = apps[0].id as string;
      process.stdout.write(kleur.dim(`앱: ${apps[0].name ?? appId}\n\n`));
    } catch {
      process.stdout.write(kleur.red(`앱 목록 파싱 실패: ${appsResult.text.slice(0, 80)}\n`));
      process.exit(1);
    }
  }

  process.stdout.write("📊 Readiness 점수 계산 중...\n");
  const readinessResult = await mcpCall(cfg.endpoint, cfg.token, "get_readiness", { app_id: appId });

  if (readinessResult.isError) {
    process.stdout.write(kleur.red(`점수 조회 실패: ${readinessResult.text}\n`));
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
    process.stdout.write(`\n점수: ${renderScore(score)}\n\n`);

    if (data.modules) {
      process.stdout.write(kleur.dim("── 모듈별 ──\n"));
      for (const [key, val] of Object.entries(data.modules)) {
        const label = MODULE_LABELS[key] ?? key;
        const color = val >= 25 ? kleur.green : val >= 10 ? kleur.yellow : kleur.red;
        process.stdout.write(`  ${label.padEnd(12)} ${color(String(val).padStart(2))}/25\n`);
      }
      process.stdout.write("\n");
    }

    if (data.blockers?.length) {
      hasBlocker = true;
      process.stdout.write(kleur.bold("🚫 블로커:\n"));
      for (const b of data.blockers) process.stdout.write(`  ${kleur.red("•")} ${b}\n`);
      process.stdout.write("\n");
    }

    if (data.warnings?.length) {
      process.stdout.write(kleur.bold("⚠ 경고:\n"));
      for (const w of data.warnings) process.stdout.write(`  ${kleur.yellow("•")} ${w}\n`);
      process.stdout.write("\n");
    }

    if (!hasBlocker) {
      process.stdout.write(score >= 80 ? kleur.green("✓ 출시 준비 완료!\n") : kleur.yellow("점수를 높이려면 대시보드를 확인하세요.\n"));
    }
  } catch {
    for (const line of readinessResult.text.split("\n")) process.stdout.write("  " + line + "\n");
  }

  if (hasBlocker && args.failOnBlocker) process.exit(1);
}
