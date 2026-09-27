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
  type Platform,
} from "./credentials.js";
import type { AppHint } from "./detect.js";
import { migrateLegacyJenkins } from "./jenkins-config.js";
import { findProjectLink } from "./project-link.js";
import { t } from "./i18n.js";
import {
  findProjectManifest,
  manifestServiceEntries,
  type ManifestServiceId,
  type ManifestService,
} from "#core/project-manifest.js";

// ── 결과 모델 ──
//
// 모든 체크는 한 곳(Reporter)을 지난다: 사람용 출력은 즉시 찍고, --json 이면 모아 두었다가
// 마지막에 한 번 찍는다. `ok` 는 여기서 파생된다 — ✗ 가 하나라도 있으면 false. 종료 코드는
// `--strict` 일 때만 `ok` 를 따른다 (cmdDoctor 참고).

export type CheckStatus = "ok" | "warn" | "fail";
/** 섹션 id 는 언어와 무관하게 고정 — JSON 소비자가 번역된 제목에 의존하지 않게. */
export type DoctorSection = "account" | "credentials" | "project" | "environment" | "apps";

export interface DoctorCheck {
  section: DoctorSection;
  status: CheckStatus;
  label: string;
  detail?: string;
}

export interface DoctorReport {
  /** ✗(fail) 가 하나도 없으면 true. 경고(⚠)는 실패가 아니다. */
  ok: boolean;
  checks: DoctorCheck[];
}

const ICON: Record<CheckStatus, string> = { ok: kleur.green("✓"), warn: kleur.yellow("⚠"), fail: kleur.red("✗") };

class Reporter {
  readonly checks: DoctorCheck[] = [];
  private current: DoctorSection = "account";
  constructor(private readonly print: boolean) {}

  section(id: DoctorSection, title: string): void {
    this.current = id;
    if (this.print) process.stdout.write("\n" + kleur.dim(`── ${title} ──\n`));
  }
  text(s: string): void {
    if (this.print) process.stdout.write(s);
  }
  private add(status: CheckStatus, label: string, detail = ""): void {
    this.checks.push({ section: this.current, status, label, ...(detail ? { detail } : {}) });
    if (this.print) {
      process.stdout.write(`  ${ICON[status]} ${label}${detail ? kleur.dim("  " + detail) : ""}\n`);
    }
  }
  ok(label: string, detail = ""): void { this.add("ok", label, detail); }
  warn(label: string, detail = ""): void { this.add("warn", label, detail); }
  fail(label: string, detail = ""): void { this.add("fail", label, detail); }
}

/** 매니페스트 서비스별 식별자 한 줄 (예: "my-app-analytics / analytics_123456789"). */
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

export interface ManifestCredentialMismatch {
  field: "keyId" | "issuerId";
  expected: string;
  actual?: string;
}

/** 매니페스트가 특정 App Store 키를 고정했으면 단순 파일 존재보다 identity를 우선한다. */
export function manifestCredentialMismatch(
  id: ManifestServiceId,
  svc: ManifestService,
  identity?: Record<string, string>,
): ManifestCredentialMismatch | null {
  if (id !== "appstore") return null;
  for (const field of ["keyId", "issuerId"] as const) {
    const expected = svc[field];
    if (expected && identity?.[field] !== expected) {
      return { field, expected, actual: identity?.[field] };
    }
  }
  return null;
}

/** 감지된 앱에서 이 프로젝트의 플랫폼을 뽑는다 (setup 과 같은 규칙: packageName=android, bundleId=ios). */
export function platformsFromHints(hints: AppHint[]): Platform[] {
  const platforms: Platform[] = [];
  if (hints.some((h) => h.packageName)) platforms.push("android");
  if (hints.some((h) => h.bundleId)) platforms.push("ios");
  return platforms;
}

/**
 * 원격(웹 콘솔 / 원격 MCP) 기능을 쓰도록 설정된 환경인가.
 *
 * Mimi Seed 토큰(config.json)은 `init`·`status`·`deploy` 같은 **원격** 경로에만 필요하다. 로컬
 * stdio MCP 만 쓰는 사용자는 이 토큰이 영원히 없는데, 예전 doctor 는 그들에게 항상 ✗ 를 줬다.
 * 그래서 "원격을 쓰려는 흔적"이 있을 때만 토큰 부재를 실패로 본다: 토큰/웹 주소 환경변수, 또는
 * 이 프로젝트의 `.mimi-seed-link.json`(웹 앱과 연결된 프로젝트). 연결 파일이 깨져 있어도 원격을
 * 쓰려던 것이므로 true.
 */
export async function remoteConfigured(cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (env.MIMI_SEED_TOKEN || env.MIMI_SEED_WEB_BASE) return true;
  try {
    return (await findProjectLink(cwd)) !== null;
  } catch {
    return true;
  }
}

/** 전체 진단. `print` 가 참이면 진행하면서 사람용 출력을 찍는다. 네트워크 호출은 원격 확인 한 번뿐. */
export async function runDoctor(opts: { cwd: string; print: boolean }): Promise<DoctorReport> {
  const { cwd } = opts;
  const m = t().doctor;
  const r = new Reporter(opts.print);
  r.text(kleur.bold(m.title + "\n\n"));

  r.section("account", m.secAuth);
  const cfg = await getEffectiveConfig();
  const remote = cfg !== null || (await remoteConfigured(cwd));
  if (!cfg) {
    if (remote) r.fail(m.noToken, m.noTokenFix);
    else r.warn(m.noTokenLocal, m.noTokenLocalDetail);
  } else {
    r.ok(m.tokenSaved, `${cfg.prefix}…  (${cfg.createdAt.slice(0, 10)})`);
    r.ok(m.endpoint, cfg.endpoint);
    if (process.env.MIMI_SEED_TOKEN) {
      r.ok(m.ciMode, m.ciModeDetail);
    }
    try {
      const res = await mcpCall(cfg.endpoint, cfg.token, "list_apps", {});
      if (res.isError) {
        r.fail(m.tokenInvalid, res.text.slice(0, 80));
      } else {
        const lines = res.text.split("\n").filter(Boolean);
        r.ok(m.serverOk, m.appCount(lines.length));
      }
    } catch (e) {
      // 네트워크 오류·타임아웃으로 doctor 전체가 죽으면 나머지 진단을 못 본다 — 한 줄 실패로 남긴다.
      r.fail(m.serverUnreachable, (e instanceof Error ? e.message : String(e)).slice(0, 120));
    }
  }

  r.section("credentials", m.secCreds);
  // 목록은 credentials.ts 레지스트리가 SSOT — 예전엔 여기 4줄만 손으로 들고 있어서
  // Jenkins/CI/Ads/Facebook/Instagram 은 doctor 에 아예 보이지 않았다.
  migrateLegacyJenkins(); // 레거시 config.json.jenkins → jenkins.json (1회성)
  const detected = detectAll(undefined, cwd);
  const hints = await detectHints(cwd);
  const platforms = platformsFromHints(hints);
  for (const spec of CREDENTIALS) {
    // 클라우드 계정(config.json / MIMI_SEED_TOKEN)은 위 "계정" 섹션이 이미 판정했다 — 두 번 찍지 않는다.
    if (spec.id === "mimiseed") continue;
    const d = detected.get(spec.id)!;
    const base = credLabel(spec);
    const note = credNote(spec);
    const label = note ? `${base} (${note})` : base;
    if (d.present) r.ok(base, d.detail);
    else if (isSatisfied(spec, detected)) r.warn(label, t().setup.fallbackWorking);
    else if (spec.requirement === "optional") r.warn(`${label}`, `→ ${spec.fix}`);
    // 플랫폼 자격증명(App Store 등)은 이 프로젝트가 그 플랫폼일 때만 필수다 — missingRequired() 와 같은
    // 규칙. 안 그러면 Android 전용 사용자가 App Store 키 때문에 영원히 exit 1 을 받는다.
    else if (spec.requirement === "platform" && !platforms.includes(spec.platform!)) {
      r.warn(label, `${t().setup.neededFor(spec.platform!)}  → ${spec.fix}`);
    }
    else r.fail(base, `→ ${spec.fix}`);
  }
  r.text(kleur.dim(m.credsHint));

  // ── 프로젝트 매니페스트(.mimi-seed.json) 기반 요구사항 ──
  // 저장소가 필요로 하는 서비스를 선언해두면, 로컬 자격증명 보유 여부와 대조해
  // "이 프로젝트에서 너한테 빠진 것"을 정확히 짚어준다.
  const loaded = findProjectManifest(cwd);
  if (loaded) {
    const projName = loaded.manifest.displayName ?? loaded.manifest.project ?? m.thisProject;
    r.section("project", m.requirements(projName));
    // 연결 판정·복구 명령 모두 레지스트리에서 파생한다 (fallback 규칙 포함 — 예: Play SA 없어도 OAuth 면 OK).
    // 매니페스트의 서비스 id 는 CredId 의 부분집합이다.
    for (const [id, svc] of manifestServiceEntries(loaded.manifest)) {
      const required = svc.required !== false;
      const detail = manifestDetail(id, svc);
      // 매니페스트는 손으로 쓰는 파일이라 레지스트리에 없는 서비스 id 가 들어올 수 있다.
      // 그것 때문에 doctor 전체가 죽으면 안 된다 — 모르는 항목은 경고만 하고 넘어간다.
      const spec = tryCredById(id);
      if (!spec) {
        r.warn(m.unknownService(id), svc.note ?? detail);
        continue;
      }
      const connected = isSatisfied(spec, detected);
      const mismatch = manifestCredentialMismatch(id, svc, detected.get(spec.id)?.identity);
      if (connected && mismatch) {
        r.fail(id, `${m.credentialMismatch(mismatch.field, mismatch.expected, mismatch.actual)}  → ${spec.fix}`);
      } else if (connected) r.ok(id, detail);
      else if (!required) r.warn(`${id} (${t().common.optional})`, svc.note ?? detail);
      else r.fail(id, `→ ${spec.fix}${detail ? "  " + detail : ""}`);
    }
  }

  r.section("environment", m.secEnv);
  const nodeVer = process.version;
  const [, major] = nodeVer.match(/v(\d+)/) ?? [];
  // Node 하한은 20 — CLI 와 MCP 서버가 같다 (.nvmrc 가 SSOT).
  if (Number(major) >= 20) {
    r.ok("Node.js", nodeVer);
  } else {
    r.fail("Node.js", m.nodeTooOld(nodeVer));
  }

  if (isGitRepo(cwd)) {
    const latestTag = getLatestTag(cwd);
    const commits = getGitLog(cwd, { limit: 5 });
    r.ok(m.gitRepo, latestTag ? m.gitTag(latestTag) : m.gitCommits(commits.length));
  } else {
    r.warn(m.noGit, m.noGitDetail);
  }

  // ANTHROPIC_API_KEY 는 위 자격증명 섹션(레지스트리)에서 이미 보고했다 — 여기서 또 찍지 않는다.

  r.section("apps", m.secApps);
  if (hints.length === 0) {
    r.warn(m.noApp, m.noAppDetail);
  } else {
    for (const h of hints) {
      const ids = [h.packageName && `android:${h.packageName}`, h.bundleId && `ios:${h.bundleId}`]
        .filter(Boolean)
        .join("  ");
      r.ok(h.name ?? m.unnamed, ids);
    }
  }

  r.text("\n");
  return { ok: !r.checks.some((c) => c.status === "fail"), checks: r.checks };
}

/**
 * `mimi-seed doctor [--strict] [--json]`.
 *
 * 기본 종료 코드는 **✗ 가 있어도 0** 이다. doctor 는 설치 스킬·시작 가이드의 마지막 "확인" 단계이고,
 * 새 머신(OAuth 아직 없음)·PAT 전용·OAuth 만 있는 크로스플랫폼 프로젝트처럼 ✗ 가 정상인 상태가
 * 흔하다 — 거기서 exit 1 을 내면 설치가 실패한 것처럼 보인다. CI 게이트로 쓰려면 `--strict`:
 * ✗ 가 하나라도 있으면 exit 1 (⚠ 는 실패가 아님). `--json` 은 어느 쪽이든 `ok` 를 담는다.
 */
export async function cmdDoctor(args: string[] = []): Promise<void> {
  const json = args.includes("--json");
  const strict = args.includes("--strict");
  const report = await runDoctor({ cwd: process.cwd(), print: !json });
  if (json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (strict && !report.ok) process.exitCode = 1;
}
