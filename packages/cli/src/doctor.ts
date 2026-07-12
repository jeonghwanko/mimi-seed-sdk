import kleur from "kleur";
import { getEffectiveConfig } from "./config.js";
import { mcpCall } from "./mcp-client.js";
import { isGitRepo, getLatestTag, getGitLog } from "./git.js";
import { detectHints } from "./detect.js";
import {
  CREDENTIALS,
  credLabel,
  credNote,
  tryCredById,
  detectAll,
  isSatisfied,
} from "./credentials.js";
import { migrateLegacyJenkins } from "./jenkins-config.js";
import { t } from "./i18n.js";
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
  const m = t().doctor;
  process.stdout.write(kleur.bold(m.title + "\n\n"));

  section(m.secAuth);
  const cfg = await getEffectiveConfig();
  if (!cfg) {
    fail(m.noToken, m.noTokenFix);
  } else {
    ok(m.tokenSaved, `${cfg.prefix}…  (${cfg.createdAt.slice(0, 10)})`);
    ok(m.endpoint, cfg.endpoint);
    if (process.env.MIMI_SEED_TOKEN) {
      ok(m.ciMode, m.ciModeDetail);
    }
    const r = await mcpCall(cfg.endpoint, cfg.token, "list_apps", {});
    if (r.isError) {
      fail(m.tokenInvalid, r.text.slice(0, 80));
    } else {
      const lines = r.text.split("\n").filter(Boolean);
      ok(m.serverOk, m.appCount(lines.length));
    }
  }

  section(m.secCreds);
  // 목록은 credentials.ts 레지스트리가 SSOT — 예전엔 여기 4줄만 손으로 들고 있어서
  // Jenkins/CI/Ads/Facebook/Instagram 은 doctor 에 아예 보이지 않았다.
  migrateLegacyJenkins(); // 레거시 config.json.jenkins → jenkins.json (1회성)
  const detected = detectAll();
  for (const spec of CREDENTIALS) {
    const d = detected.get(spec.id)!;
    const base = credLabel(spec);
    const note = credNote(spec);
    const label = note ? `${base} (${note})` : base;
    if (d.present) ok(base, d.detail);
    else if (isSatisfied(spec, detected)) warn(label, t().setup.fallbackWorking);
    else if (spec.requirement === "optional") warn(`${label}`, `→ ${spec.fix}`);
    else fail(base, `→ ${spec.fix}`);
  }
  process.stdout.write(kleur.dim(m.credsHint));

  // ── 프로젝트 매니페스트(.mimi-seed.json) 기반 요구사항 ──
  // 저장소가 필요로 하는 서비스를 선언해두면, 로컬 자격증명 보유 여부와 대조해
  // "이 프로젝트에서 너한테 빠진 것"을 정확히 짚어준다.
  const loaded = findProjectManifest(cwd);
  if (loaded) {
    const projName = loaded.manifest.displayName ?? loaded.manifest.project ?? m.thisProject;
    section(m.requirements(projName));
    // 연결 판정·복구 명령 모두 레지스트리에서 파생한다 (fallback 규칙 포함 — 예: Play SA 없어도 OAuth 면 OK).
    // 매니페스트의 서비스 id 는 CredId 의 부분집합이다.
    for (const [id, svc] of manifestServiceEntries(loaded.manifest)) {
      const required = svc.required !== false;
      const detail = manifestDetail(id, svc);
      // 매니페스트는 손으로 쓰는 파일이라 레지스트리에 없는 서비스 id 가 들어올 수 있다.
      // 그것 때문에 doctor 전체가 죽으면 안 된다 — 모르는 항목은 경고만 하고 넘어간다.
      const spec = tryCredById(id);
      if (!spec) {
        warn(m.unknownService(id), svc.note ?? detail);
        continue;
      }
      const connected = isSatisfied(spec, detected);
      if (connected) ok(id, detail);
      else if (!required) warn(`${id} (${t().common.optional})`, svc.note ?? detail);
      else fail(id, `→ ${spec.fix}${detail ? "  " + detail : ""}`);
    }
  }

  section(m.secEnv);
  const nodeVer = process.version;
  const [, major] = nodeVer.match(/v(\d+)/) ?? [];
  // Node 하한은 20 — CLI 와 MCP 서버가 같다 (.nvmrc 가 SSOT).
  if (Number(major) >= 20) {
    ok("Node.js", nodeVer);
  } else {
    fail("Node.js", m.nodeTooOld(nodeVer));
  }

  if (isGitRepo(cwd)) {
    const latestTag = getLatestTag(cwd);
    const commits = getGitLog(cwd, { limit: 5 });
    ok(m.gitRepo, latestTag ? m.gitTag(latestTag) : m.gitCommits(commits.length));
  } else {
    warn(m.noGit, m.noGitDetail);
  }

  // ANTHROPIC_API_KEY 는 위 자격증명 섹션(레지스트리)에서 이미 보고했다 — 여기서 또 찍지 않는다.

  section(m.secApps);
  const hints = await detectHints(cwd);
  if (hints.length === 0) {
    warn(m.noApp, m.noAppDetail);
  } else {
    for (const h of hints) {
      const ids = [h.packageName && `android:${h.packageName}`, h.bundleId && `ios:${h.bundleId}`]
        .filter(Boolean)
        .join("  ");
      ok(h.name ?? m.unnamed, ids);
    }
  }

  process.stdout.write("\n");
}
