// 자격증명 레지스트리 — `doctor` · `auth status --all` · `setup` 이 **공유하는 단일 SSOT**.
//
// 예전엔 doctor 와 auth 가 각자 4줄짜리 목록을 손으로 들고 있었고, Jenkins/CI/Ads/FB/IG 는
// 아무 데도 없어서 doctor 가 그 5개를 보지 못했다. 새 자격증명을 추가할 땐 여기 한 곳만 고친다.
//
// detect 는 **순수 fs 검사**다 (네트워크 호출 없음) — doctor/setup 이 오프라인에서도 즉시 뜨도록.
// 토큰 유효성 검증은 각 setup bin 이 저장 직전에 한다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpBin } from "./mcp-bin.js";

export type CredId =
  | "mimiseed"
  | "oauth"
  | "appstore"
  | "playstore"
  | "bigquery"
  | "jenkins"
  | "github"
  | "gitlab"
  | "googleads"
  | "facebook"
  | "instagram"
  | "anthropic";

/**
 * required — 항상 필요.
 * platform — 그 플랫폼을 배포할 때만 필요 (예: iOS 프로젝트에서의 App Store Connect).
 * optional — 없어도 대부분 동작.
 */
export type Requirement = "required" | "platform" | "optional";

export type CredGroup = "core" | "ci" | "marketing";

export type SetupKind =
  | { kind: "mcp-bin"; bin: McpBin; args?: string[] }
  | { kind: "cli"; handler: "github" | "gitlab" }
  | { kind: "command"; run: string }
  | { kind: "env"; envVar: string };

export interface Detected {
  present: boolean;
  detail?: string;
}

export interface CredSpec {
  id: CredId;
  label: string;
  requirement: Requirement;
  platform?: "android" | "ios";
  group: CredGroup;
  /** 표시용 경로 (~ 표기). */
  file?: string;
  /** 이 자격증명이 없어도, 이 중 하나가 있으면 "동작은 한다"는 뜻. */
  fallbackOn?: CredId[];
  /** doctor / status 가 보여줄 복구 명령. */
  fix: string;
  setup: SetupKind;
  /** "이거 어떻게 구해요?" — 벤더 콘솔에서 미리 발급받아 와야 하는 것들. */
  obtain: string[];
  /** docs/credentials.md 의 앵커 (마법사가 딥링크한다). */
  docsAnchor?: string;
  note?: string;
  detect(home: string): Detected;
}

// ── detect 헬퍼 ──

function credDir(home: string): string {
  return path.join(home, ".mimi-seed");
}

function hasFile(home: string, name: string): boolean {
  return fs.existsSync(path.join(credDir(home), name));
}

function anyFileStarting(home: string, prefix: string): boolean {
  try {
    return fs.readdirSync(credDir(home)).some((f) => f.startsWith(prefix));
  } catch {
    return false;
  }
}

function readJson<T>(home: string, name: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(credDir(home), name), "utf-8")) as T;
  } catch {
    return null;
  }
}

/** Play SA 는 기본 파일과 패키지별 디렉토리 **양쪽**을 봐야 한다. */
function hasPlaySa(home: string): boolean {
  if (hasFile(home, "play-service-account.json")) return true;
  try {
    return fs
      .readdirSync(path.join(credDir(home), "play-service-accounts"))
      .some((f) => f.endsWith(".json"));
  } catch {
    return false;
  }
}

function ciDetect(home: string, want: "github" | "gitlab"): Detected {
  const ci = readJson<{ provider?: string; owner?: string; repo?: string }>(home, "ci.json");
  if (!ci || ci.provider !== want) return { present: false };
  return { present: true, detail: ci.owner && ci.repo ? `${ci.owner}/${ci.repo}` : undefined };
}

// ── 레지스트리 ──

export const CREDENTIALS: readonly CredSpec[] = [
  {
    id: "mimiseed",
    label: "Mimi Seed 계정 (클라우드)",
    requirement: "required",
    group: "core",
    file: "~/.mimi-seed/config.json",
    fix: "mimi-seed init",
    setup: { kind: "command", run: "mimi-seed init" },
    obtain: [
      "https://mimi-seed.pryzm.gg 에서 가입/로그인하면 끝 — 브라우저가 알아서 토큰을 넘겨준다.",
      "CI 에서는 MIMI_SEED_TOKEN 환경변수로 대체할 수 있다.",
    ],
    docsAnchor: "cloud-pat",
    detect: (home) => {
      if (process.env.MIMI_SEED_TOKEN) return { present: true, detail: "MIMI_SEED_TOKEN (env)" };
      const cfg = readJson<{ prefix?: string }>(home, "config.json");
      return cfg?.prefix ? { present: true, detail: `${cfg.prefix}…` } : { present: false };
    },
  },
  {
    id: "oauth",
    label: "Google OAuth",
    requirement: "required",
    group: "core",
    file: "~/.mimi-seed/tokens.json",
    fix: "mimi-seed auth login",
    setup: { kind: "mcp-bin", bin: "mimi-seed-auth" },
    obtain: [
      "미리 발급받을 게 **없다**. 브라우저 로그인 한 번이면 끝.",
      "이 토큰 하나가 Firebase · AdMob · Play · Google Ads · Search Console · GA4 · IAM · BigQuery 를 모두 연다.",
      "⚠️ 로그인 화면에서 거부(access_denied) 당하면 앱이 아직 '테스팅' 모드라 그렇다 —",
      "   운영자에게 네 Google 계정을 Test users 에 추가해달라고 요청해야 한다.",
    ],
    docsAnchor: "google-oauth",
    note: "8개 Google 서비스의 공통 관문",
    detect: (home) => ({ present: hasFile(home, "tokens.json") }),
  },
  {
    id: "appstore",
    label: "App Store Connect",
    requirement: "platform",
    platform: "ios",
    group: "core",
    file: "~/.mimi-seed/appstore.json",
    fix: "mimi-seed auth appstore",
    setup: { kind: "mcp-bin", bin: "mimi-seed-appstore-auth" },
    obtain: [
      "유료 Apple Developer Program 멤버십 + Admin/App Manager 권한이 먼저 필요하다.",
      "App Store Connect → 사용자 및 액세스 → 통합 → App Store Connect API → 키 생성",
      "가져올 것 3개: Issuer ID · Key ID · .p8 파일",
      "⚠️ .p8 은 **딱 한 번만** 다운로드된다. 잃어버리면 키를 폐기하고 새로 만들어야 한다.",
    ],
    docsAnchor: "app-store-connect",
    detect: (home) => {
      const cfg = readJson<{ keyId?: string }>(home, "appstore.json");
      return cfg ? { present: true, detail: cfg.keyId ? `keyId ${cfg.keyId}` : undefined } : { present: false };
    },
  },
  {
    id: "playstore",
    label: "Play 서비스 계정",
    // 선택이다 — helpers.ts 의 requirePlayStoreAuth 가 SA → OAuth 로 폴백하고,
    // 로그인 시 androidpublisher 스코프를 이미 받으므로 로컬 작업은 OAuth 로 된다.
    requirement: "optional",
    group: "core",
    file: "~/.mimi-seed/play-service-account.json",
    fallbackOn: ["oauth"],
    fix: "mimi-seed auth playstore",
    setup: { kind: "mcp-bin", bin: "mimi-seed-playstore-auth" },
    obtain: [
      "로컬에서 쓸 거면 **필요 없다** — Google OAuth 로 대부분의 Play 작업이 된다.",
      "CI/헤드리스(브라우저 없는 환경)에서만 필요:",
      "  1. GCP Console → IAM & Admin → 서비스 계정 → 키 → 새 키 만들기 → JSON",
      "  2. Play Console → 설정 → 사용자 및 권한 → 그 서비스 계정 이메일을 초대",
      "  3. 권한 전파에 ~5분 걸린다. 그 전엔 403 이 뜨는 게 정상이다.",
      "Claude 에게 `setup_playstore_connection` 을 시키면 1번을 자동화해준다.",
    ],
    docsAnchor: "play-service-account",
    note: "선택 — 로컬은 OAuth 로 가능, CI/헤드리스는 필수",
    detect: (home) => ({ present: hasPlaySa(home) }),
  },
  {
    id: "bigquery",
    label: "BigQuery 서비스 계정",
    requirement: "optional",
    group: "core",
    file: "~/.mimi-seed/bigquery-service-account.json",
    fallbackOn: ["oauth"],
    fix: "mimi-seed auth bigquery",
    setup: { kind: "mcp-bin", bin: "mimi-seed-bigquery-auth" },
    obtain: [
      "OAuth 로도 동작하지만, Workspace 재인증 정책(invalid_rapt)에 막히는 환경이면 서비스 계정이 필요하다.",
      "GCP Console → IAM & Admin → 서비스 계정 → 키 → 새 키 만들기 → JSON",
      "그 서비스 계정에 IAM 역할을 **직접** 부여해야 한다 (자동으로 안 된다):",
      "  • roles/bigquery.jobUser    (쿼리 실행)",
      "  • roles/bigquery.dataViewer (데이터셋 읽기)",
    ],
    docsAnchor: "bigquery",
    note: "선택 — OAuth 폴백 가능",
    detect: (home) => ({ present: anyFileStarting(home, "bigquery") }),
  },
  {
    id: "github",
    label: "GitHub Actions",
    requirement: "optional",
    group: "ci",
    file: "~/.mimi-seed/ci.json",
    fix: "mimi-seed auth ci",
    setup: { kind: "cli", handler: "github" },
    obtain: [
      "GitHub → Settings → Developer settings → Personal access tokens",
      "⚠️ 스코프 **`repo` 와 `workflow` 를 둘 다** 체크해야 한다.",
      "   `workflow` 가 없으면 워크플로 dispatch 가 403 으로 막힌다.",
      "그 외: owner(조직/사용자) · repo 이름. GitHub Enterprise 면 host URL 도.",
    ],
    docsAnchor: "ci-github-gitlab",
    detect: (home) => ciDetect(home, "github"),
  },
  {
    id: "gitlab",
    label: "GitLab CI",
    requirement: "optional",
    group: "ci",
    file: "~/.mimi-seed/ci.json",
    fix: "mimi-seed auth ci",
    setup: { kind: "cli", handler: "gitlab" },
    obtain: [
      "GitLab → 사용자 설정 → Access Tokens → `api` 스코프로 발급 (glpat-…)",
      "그 외: namespace/group · 프로젝트 이름. self-hosted 면 URL 도.",
    ],
    docsAnchor: "ci-github-gitlab",
    detect: (home) => ciDetect(home, "gitlab"),
  },
  {
    id: "jenkins",
    label: "Jenkins",
    requirement: "optional",
    group: "ci",
    file: "~/.mimi-seed/jenkins.json",
    fix: "mimi-seed auth jenkins",
    setup: { kind: "mcp-bin", bin: "mimi-seed-jenkins-auth" },
    obtain: [
      "Jenkins → [사용자 이름] → 설정 → API Token → \"Add new Token\"",
      "비밀번호가 아니라 **API Token** 이다.",
      "로컬 Jenkins 가 없어도 회사/원격 서버 URL 을 그대로 쓰면 된다.",
    ],
    docsAnchor: "jenkins",
    detect: (home) => {
      const cfg = readJson<{ url?: string }>(home, "jenkins.json");
      return cfg?.url ? { present: true, detail: cfg.url } : { present: false };
    },
  },
  {
    id: "googleads",
    label: "Google Ads",
    requirement: "optional",
    group: "marketing",
    file: "~/.mimi-seed/google-ads.json",
    fix: "mimi-seed auth googleads",
    setup: { kind: "mcp-bin", bin: "mimi-seed-googleads-auth" },
    obtain: [
      "Google Ads → 도구 및 설정 → 설정 → API 센터 → Developer Token 발급",
      "⚠️ 최초 발급 토큰은 '테스트' 등급이다. 실계정 데이터를 보려면 **승인 심사**를 통과해야 하고,",
      "   심사에는 시간이 걸린다 (즉시 발급되지 않는다).",
      "그 외: Customer ID (예: 123-456-7890). MCC 를 쓰면 관리자 계정 ID 도.",
      "인증 자체는 Google OAuth 의 `adwords` 스코프를 탄다 — 옛 토큰이면 재로그인이 필요할 수 있다.",
    ],
    docsAnchor: "google-ads",
    detect: (home) => {
      const cfg = readJson<{ customerId?: string }>(home, "google-ads.json");
      return cfg?.customerId ? { present: true, detail: cfg.customerId } : { present: false };
    },
  },
  {
    id: "facebook",
    label: "Facebook 페이지",
    requirement: "optional",
    group: "marketing",
    file: "~/.mimi-seed/facebook.json",
    fix: "mimi-seed auth facebook",
    setup: { kind: "mcp-bin", bin: "mimi-seed-social-auth", args: ["facebook"] },
    obtain: [
      "Meta 개발자 앱 + 대상 페이지의 관리자 권한이 먼저 필요하다.",
      "Graph API Explorer → 권한 pages_show_list, pages_manage_posts, pages_read_engagement",
      "→ User Token 생성 → /me/accounts 호출 → 그 페이지의 access_token (EAA…)",
      "long-lived 토큰을 권장한다 (약 60일).",
    ],
    docsAnchor: "facebook",
    detect: (home) => {
      const cfg = readJson<{ pageId?: string; pageName?: string }>(home, "facebook.json");
      return cfg?.pageId ? { present: true, detail: cfg.pageName ?? cfg.pageId } : { present: false };
    },
  },
  {
    id: "instagram",
    label: "Instagram",
    requirement: "optional",
    group: "marketing",
    file: "~/.mimi-seed/instagram.json",
    fix: "mimi-seed auth instagram",
    setup: { kind: "mcp-bin", bin: "mimi-seed-social-auth", args: ["instagram"] },
    obtain: [
      "long-lived 토큰 두 형식 모두 지원한다 (자동 감지):",
      "  • IGAA… — Instagram Login (Meta 신규 방식, Facebook 페이지 불필요)",
      "  • EAA…  — Facebook Login (IG **비즈니스** 계정이 FB 페이지에 연결돼 있어야 함)",
      "토큰 수명은 약 60일이다.",
    ],
    docsAnchor: "instagram",
    detect: (home) => {
      const cfg = readJson<{ userId?: string; username?: string }>(home, "instagram.json");
      return cfg?.userId ? { present: true, detail: cfg.username ?? cfg.userId } : { present: false };
    },
  },
  {
    id: "anthropic",
    label: "ANTHROPIC_API_KEY",
    requirement: "optional",
    group: "marketing",
    fix: "export ANTHROPIC_API_KEY=sk-ant-…",
    setup: { kind: "env", envVar: "ANTHROPIC_API_KEY" },
    obtain: [
      "Anthropic Console (console.anthropic.com) → API Keys 에서 발급.",
      "환경변수로만 읽는다 — 설정 명령이 따로 없다.",
      "없어도 된다: `mimi-seed notes` 는 AI 없이 커밋 목록 기반으로 동작한다.",
    ],
    docsAnchor: "anthropic-api-key",
    note: "선택 — AI 릴리스 노트/리뷰 답변 생성용",
    detect: () => ({ present: Boolean(process.env.ANTHROPIC_API_KEY) }),
  },
] as const;

export function credById(id: CredId): CredSpec {
  const spec = tryCredById(id);
  if (!spec) throw new Error(`알 수 없는 자격증명: ${id}`);
  return spec;
}

/** 손으로 쓴 `.mimi-seed.json` 처럼 신뢰할 수 없는 입력에서 id 가 올 때 쓴다 (throw 하지 않음). */
export function tryCredById(id: string): CredSpec | undefined {
  return CREDENTIALS.find((c) => c.id === id);
}

export function detectAll(home: string = os.homedir()): Map<CredId, Detected> {
  return new Map(CREDENTIALS.map((c) => [c.id, c.detect(home)]));
}

/** fallback 을 감안한 "동작하는가" 판정 — 예: Play SA 가 없어도 OAuth 가 있으면 동작한다. */
export function isSatisfied(spec: CredSpec, detected: Map<CredId, Detected>): boolean {
  if (detected.get(spec.id)?.present) return true;
  return (spec.fallbackOn ?? []).some((f) => detected.get(f)?.present);
}

export type Platform = "android" | "ios";

/** 이 프로젝트에서 **빠져 있으면 안 되는** 것들. */
export function missingRequired(
  detected: Map<CredId, Detected>,
  platforms: Platform[],
): CredSpec[] {
  return CREDENTIALS.filter((spec) => {
    if (spec.requirement === "optional") return false;
    if (spec.requirement === "platform" && !platforms.includes(spec.platform!)) return false;
    return !isSatisfied(spec, detected);
  });
}

const GROUP_ORDER: Record<CredGroup, number> = { core: 0, ci: 1, marketing: 2 };
const REQ_ORDER: Record<Requirement, number> = { required: 0, platform: 1, optional: 2 };

export interface PlanOpts {
  /** 이 id 들만 다룬다. */
  only?: CredId[];
  /** 이미 연결돼 있어도 다시 설정한다. */
  reconnect?: CredId[];
  platforms?: Platform[];
}

/**
 * 마법사가 순회할 목록 — 이미 연결된 것은 제외(멱등·재개 가능),
 * core → ci → marketing 순, 그 안에서 필수 먼저.
 */
export function planSetup(detected: Map<CredId, Detected>, opts: PlanOpts = {}): CredSpec[] {
  const reconnect = new Set(opts.reconnect ?? []);
  const only = opts.only ? new Set(opts.only) : null;
  const platforms = opts.platforms ?? [];

  return CREDENTIALS.filter((spec) => {
    if (only && !only.has(spec.id)) return false;
    if (reconnect.has(spec.id)) return true;
    if (detected.get(spec.id)?.present) return false; // 이미 연결됨 → 건너뜀
    // 플랫폼 전용인데 그 플랫폼이 아니면 굳이 묻지 않는다.
    if (spec.requirement === "platform" && platforms.length > 0 && !platforms.includes(spec.platform!)) {
      return false;
    }
    return true;
  }).sort(
    (a, b) =>
      GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
      REQ_ORDER[a.requirement] - REQ_ORDER[b.requirement],
  );
}
