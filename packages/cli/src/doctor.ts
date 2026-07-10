import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import kleur from "kleur";
import { getEffectiveConfig } from "./config.js";
import { mcpCall } from "./mcp-client.js";
import { isGitRepo, getLatestTag, getGitLog } from "./git.js";
import { detectHints } from "./detect.js";
import {
  findProjectManifest,
  manifestServiceEntries,
  type ManifestServiceId,
  type ManifestService,
} from "./project-manifest.js";

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

/** 매니페스트 서비스별 식별자 한 줄 (예: "ads-coffee / analytics_530080532"). */
function manifestDetail(id: ManifestServiceId, svc: ManifestService): string {
  const parts: string[] = [];
  if (id === "bigquery") {
    if (svc.projectId) parts.push(svc.projectId);
    if (svc.dataset) parts.push(svc.dataset);
  } else if (id === "playstore" && svc.packageName) {
    parts.push(svc.packageName);
  } else if (id === "appstore" && svc.keyId) {
    parts.push(`keyId ${svc.keyId}`);
  } else if (id === "jenkins" && svc.url) {
    parts.push(svc.url);
  }
  return parts.join(" / ");
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

  section("로컬 MCP 자격증명 (~/.mimi-seed)");
  const credDir = path.join(os.homedir(), ".mimi-seed");
  const hasFile = (name: string) => fs.existsSync(path.join(credDir, name));
  const hasPrefix = (prefix: string) => {
    try {
      return fs.readdirSync(credDir).some((f) => f.startsWith(prefix));
    } catch {
      return false;
    }
  };
  const hasPlaySa =
    hasFile("play-service-account.json") ||
    (() => {
      try {
        return fs.readdirSync(path.join(credDir, "play-service-accounts")).some((f) => f.endsWith(".json"));
      } catch {
        return false;
      }
    })();
  const oauthPresent = hasFile("tokens.json");
  const appstorePresent = hasFile("appstore.json");
  const bigquerySaPresent = hasPrefix("bigquery");
  const creds: Array<[string, boolean, string]> = [
    ["Google OAuth (Firebase/AdMob/Play/Ads)", oauthPresent, "mimi-seed auth login"],
    ["App Store Connect", appstorePresent, "mimi-seed auth appstore"],
    ["Play 서비스 계정 (선택 — OAuth로도 가능)", hasPlaySa, "mimi-seed auth playstore"],
    ["BigQuery 서비스 계정", bigquerySaPresent, "mimi-seed auth bigquery"],
  ];
  for (const [label, present, cmd] of creds) {
    if (present) ok(label);
    else warn(label, `→ ${cmd}`);
  }
  process.stdout.write(kleur.dim("  OAuth 토큰 신선도 확인: mimi-seed auth status\n"));

  // ── 프로젝트 매니페스트(.mimi-seed.json) 기반 요구사항 ──
  // 저장소가 필요로 하는 서비스를 선언해두면, 로컬 자격증명 보유 여부와 대조해
  // "이 프로젝트에서 너한테 빠진 것"을 정확히 짚어준다.
  const loaded = findProjectManifest(cwd);
  if (loaded) {
    const projName = loaded.manifest.displayName ?? loaded.manifest.project ?? "이 프로젝트";
    section(`${projName} 요구사항 (.mimi-seed.json)`);
    // OAuth 는 BigQuery/Play 의 fallback 이기도 하므로 연결 판정에 함께 반영.
    const connectedOf: Record<ManifestServiceId, boolean> = {
      oauth: oauthPresent,
      bigquery: bigquerySaPresent || oauthPresent,
      playstore: hasPlaySa || oauthPresent,
      appstore: appstorePresent,
      jenkins: false, // mimi-seed 로컬 자격증명 대상 아님(별도 MCP) — note 로만 안내
    };
    const fixOf: Record<ManifestServiceId, string> = {
      oauth: "mimi-seed auth login",
      bigquery: "mimi-seed auth bigquery",
      playstore: "mimi-seed auth playstore",
      appstore: "mimi-seed auth appstore",
      jenkins: "claude mcp add <your-jenkins-mcp> -s user",
    };
    for (const [id, svc] of manifestServiceEntries(loaded.manifest)) {
      const required = svc.required !== false;
      const connected = connectedOf[id];
      const detail = manifestDetail(id, svc);
      if (connected) ok(id, detail);
      else if (!required) warn(`${id} (선택)`, svc.note ?? detail);
      else fail(id, `→ ${fixOf[id]}${detail ? "  " + detail : ""}`);
    }
  }

  section("로컬 환경");
  const nodeVer = process.version;
  const [, major] = nodeVer.match(/v(\d+)/) ?? [];
  // CLI 는 Node 18+ 로 돌지만 Local MCP 서버(@yoonion/mimi-seed-mcp)는 20+ 필요 —
  // 18/19 에서 doctor 가 ✓ 를 주면 MCP 서버만 조용히 죽는 오진이 된다.
  if (Number(major) >= 20) {
    ok("Node.js", nodeVer);
  } else if (Number(major) >= 18) {
    warn("Node.js", `${nodeVer} — CLI 는 동작하지만 Local MCP 서버(@yoonion/mimi-seed-mcp)는 v20 이상 필요`);
  } else {
    fail("Node.js", `${nodeVer} — v18 이상(CLI) / v20 이상(Local MCP) 필요`);
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
