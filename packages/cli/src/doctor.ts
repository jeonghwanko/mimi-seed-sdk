import kleur from "kleur";
import { getEffectiveConfig } from "./config.js";
import { mcpCall } from "./mcp-client.js";
import { isGitRepo, getLatestTag, getGitLog } from "./git.js";
import { detectHints } from "./detect.js";

function ok(label: string, detail = "") {
  process.stdout.write(`  ${kleur.green("✓")} ${label}${detail ? kleur.dim("  " + detail) : ""}\n`);
}
function warn(label: string, detail = "") {
  process.stdout.write(`  ${kleur.yellow("⚠")} ${label}${detail ? kleur.dim("  " + detail) : ""}\n`);
}
function fail(label: string, detail = "") {
  process.stdout.write(`  ${kleur.red("✗")} ${label}${detail ? kleur.dim("  " + detail) : ""}\n`);
}
function section(title: string) {
  process.stdout.write("\n" + kleur.dim(`── ${title} ──\n`));
}

export async function cmdDoctor(): Promise<void> {
  const cwd = process.cwd();
  process.stdout.write(kleur.bold("mimi-seed doctor\n\n"));

  section("인증");
  const cfg = await getEffectiveConfig();
  if (!cfg) {
    fail("Mimi Seed 토큰 없음", "`mimi-seed init` 실행 필요");
  } else {
    ok("토큰 저장됨", `${cfg.prefix}…  (${cfg.createdAt.slice(0, 10)})`);
    ok("엔드포인트", cfg.endpoint);
    if (process.env.MIMI_SEED_TOKEN) {
      ok("CI 모드", "MIMI_SEED_TOKEN 환경변수 사용 중");
    }
    const r = await mcpCall(cfg.endpoint, cfg.token, "list_apps", {});
    if (r.isError) {
      fail("토큰 검증 실패", r.text.slice(0, 80));
    } else {
      const lines = r.text.split("\n").filter(Boolean);
      ok("Mimi Seed 서버 연결됨", `앱 ${lines.length}개`);
    }
  }

  section("로컬 환경");
  const nodeVer = process.version;
  const [, major] = nodeVer.match(/v(\d+)/) ?? [];
  if (Number(major) >= 18) {
    ok("Node.js", nodeVer);
  } else {
    fail("Node.js", `${nodeVer} — v18 이상 필요`);
  }

  if (isGitRepo(cwd)) {
    const latestTag = getLatestTag(cwd);
    const commits = getGitLog(cwd, { limit: 5 });
    ok("Git 저장소", latestTag ? `최신 태그: ${latestTag}` : `커밋 ${commits.length}개`);
  } else {
    warn("Git 저장소 없음", "mimi-seed notes 사용 불가");
  }

  if (process.env.ANTHROPIC_API_KEY) {
    ok("ANTHROPIC_API_KEY", "AI 릴리즈 노트 생성 사용 가능");
  } else {
    warn("ANTHROPIC_API_KEY 없음", "설정 시 AI 릴리즈 노트/리뷰 답변 생성 가능");
  }

  section("앱 감지");
  const hints = await detectHints(cwd);
  if (hints.length === 0) {
    warn("앱 감지 없음", "app.json / build.gradle / Info.plist 없음");
  } else {
    for (const h of hints) {
      const ids = [h.packageName && `android:${h.packageName}`, h.bundleId && `ios:${h.bundleId}`]
        .filter(Boolean)
        .join("  ");
      ok(h.name ?? "(이름 미상)", ids);
    }
  }

  process.stdout.write("\n");
}
