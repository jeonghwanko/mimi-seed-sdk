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
import type { Lang } from "./settings.js";
import { resolveLang } from "./settings.js";

/** 사람이 읽는 텍스트는 언어별로 들고 있는다 — 렌더 시점에 resolveLang() 으로 고른다. */
export type LocalizedText = Record<Lang, string>;
export type LocalizedLines = Record<Lang, string[]>;

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
  | "threads"
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
  /** 파일은 있지만 곧 재연결이 필요한 시간 기반 자격증명 상태. */
  freshness?: "fresh" | "expiring" | "expired";
  /** 상태표 표시용 남은 일수. expired 면 0. */
  daysRemaining?: number;
}

export interface CredSpec {
  id: CredId;
  label: LocalizedText;
  requirement: Requirement;
  platform?: "android" | "ios";
  group: CredGroup;
  /** 표시용 경로 (~ 표기). */
  file?: string;
  /** 이 자격증명이 없어도, 이 중 하나가 있으면 "동작은 한다"는 뜻. */
  fallbackOn?: CredId[];
  /** doctor / status 가 보여줄 복구 명령. 명령어라 번역하지 않는다. */
  fix: string;
  setup: SetupKind;
  /** "이거 어떻게 구해요?" — 벤더 콘솔에서 미리 발급받아 와야 하는 것들. */
  obtain: LocalizedLines;
  /** docs/credentials.md 의 앵커 (마법사가 딥링크한다). */
  docsAnchor?: string;
  note?: LocalizedText;
  detect(home: string): Detected;
}

// ── 지역화 접근자 — 렌더 시점에 언어를 고른다 (모듈 로드 시점이 아니다). ──

export function credLabel(spec: CredSpec, lang: Lang = resolveLang()): string {
  return spec.label[lang];
}

export function credNote(spec: CredSpec, lang: Lang = resolveLang()): string | undefined {
  return spec.note?.[lang];
}

export function credObtain(spec: CredSpec, lang: Lang = resolveLang()): string[] {
  return spec.obtain[lang];
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

const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Meta 장기 토큰은 파일 존재만으로 연결됐다고 보면 안 된다.
 * 네트워크 없이도 setup/doctor 가 즉시 뜨도록 저장된 expiresAt 만 판정하고,
 * 실제 API 검증은 기존 setup bin 이 저장 직전에 담당한다.
 */
function detectSocialToken(
  home: string,
  file: string,
  idKey: "pageId" | "userId",
  tokenKey: "pageAccessToken" | "accessToken",
): Detected {
  const cfg = readJson<Record<string, unknown>>(home, file);
  const id = cfg?.[idKey];
  const token = cfg?.[tokenKey];
  if (typeof id !== "string" || !id || typeof token !== "string" || !token) {
    return { present: false };
  }

  const display =
    (typeof cfg.username === "string" && cfg.username) ||
    (typeof cfg.pageName === "string" && cfg.pageName) ||
    id;
  const expiresAt = typeof cfg.expiresAt === "string" ? Date.parse(cfg.expiresAt) : NaN;
  if (!Number.isFinite(expiresAt)) return { present: true, detail: display };

  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) {
    return { present: true, detail: display, freshness: "expired", daysRemaining: 0 };
  }

  const daysRemaining = Math.max(1, Math.ceil(remainingMs / 86_400_000));
  if (remainingMs <= EXPIRING_SOON_MS) {
    return { present: true, detail: display, freshness: "expiring", daysRemaining };
  }
  return { present: true, detail: display, freshness: "fresh", daysRemaining };
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
    label: {
      ko: "Mimi Seed 계정 (클라우드)",
      en: "Mimi Seed account (cloud)",
    },
    requirement: "required",
    group: "core",
    file: "~/.mimi-seed/config.json",
    fix: "mimi-seed init",
    setup: { kind: "command", run: "mimi-seed init" },
    obtain: {
      ko: [
        "https://mimi-seed.pryzm.gg 에서 가입/로그인하면 끝 — 브라우저가 알아서 토큰을 넘겨준다.",
        "CI 에서는 MIMI_SEED_TOKEN 환경변수로 대체할 수 있다.",
      ],
      en: [
        "Sign up / sign in at https://mimi-seed.pryzm.gg — the browser hands the token back for you.",
        "In CI, set the MIMI_SEED_TOKEN environment variable instead.",
      ],
    },
    docsAnchor: "cloud-pat",
    detect: (home) => {
      if (process.env.MIMI_SEED_TOKEN) return { present: true, detail: "MIMI_SEED_TOKEN (env)" };
      const cfg = readJson<{ prefix?: string }>(home, "config.json");
      return cfg?.prefix ? { present: true, detail: `${cfg.prefix}…` } : { present: false };
    },
  },
  {
    id: "oauth",
    label: {
      ko: "Google OAuth",
      en: "Google OAuth",
    },
    requirement: "required",
    group: "core",
    file: "~/.mimi-seed/tokens.json",
    fix: "mimi-seed auth login",
    setup: { kind: "mcp-bin", bin: "mimi-seed-auth" },
    obtain: {
      ko: [
        "미리 발급받을 게 **없다**. 브라우저 로그인 한 번이면 끝.",
        "이 토큰 하나가 Firebase · AdMob · Play · Google Ads · Search Console · GA4 · IAM · BigQuery 를 모두 연다.",
        "⚠️ 로그인 화면에서 거부(access_denied) 당하면 앱이 아직 '테스팅' 모드라 그렇다 —",
        "   운영자에게 네 Google 계정을 Test users 에 추가해달라고 요청해야 한다.",
      ],
      en: [
        "**Nothing** to fetch beforehand. One browser sign-in is all it takes.",
        "This single token unlocks Firebase · AdMob · Play · Google Ads · Search Console · GA4 · IAM · BigQuery.",
        "⚠️ If the login screen blocks you (access_denied), the app is still in 'testing' mode —",
        "   ask whoever operates it to add your Google account under Test users. Retrying alone never works.",
      ],
    },
    docsAnchor: "google-oauth",
    note: {
      ko: "8개 Google 서비스의 공통 관문",
      en: "the shared gateway to 8 Google services",
    },
    detect: (home) => ({ present: hasFile(home, "tokens.json") }),
  },
  {
    id: "appstore",
    label: {
      ko: "App Store Connect",
      en: "App Store Connect",
    },
    requirement: "platform",
    platform: "ios",
    group: "core",
    file: "~/.mimi-seed/appstore.json",
    fix: "mimi-seed auth appstore",
    setup: { kind: "mcp-bin", bin: "mimi-seed-appstore-auth" },
    obtain: {
      ko: [
        "유료 Apple Developer Program 멤버십 + Admin/App Manager 권한이 먼저 필요하다.",
        "App Store Connect → 사용자 및 액세스 → 통합 → App Store Connect API → 키 생성",
        "가져올 것 3개: Issuer ID · Key ID · .p8 파일",
        "⚠️ .p8 은 **딱 한 번만** 다운로드된다. 잃어버리면 키를 폐기하고 새로 만들어야 한다.",
      ],
      en: [
        "You need a **paid** Apple Developer Program membership and the Admin / App Manager role first.",
        "App Store Connect → Users and Access → Integrations → App Store Connect API → generate a key",
        "Collect three things: Issuer ID · Key ID · the .p8 file",
        "⚠️ The .p8 downloads **exactly once**. Lose it and you must revoke the key and issue a new one.",
      ],
    },
    docsAnchor: "app-store-connect",
    detect: (home) => {
      const cfg = readJson<{ keyId?: string }>(home, "appstore.json");
      return cfg ? { present: true, detail: cfg.keyId ? `keyId ${cfg.keyId}` : undefined } : { present: false };
    },
  },
  {
    id: "playstore",
    label: {
      ko: "Play 서비스 계정",
      en: "Play service account",
    },
    // 선택이다 — helpers.ts 의 requirePlayStoreAuth 가 SA → OAuth 로 폴백하고,
    // 로그인 시 androidpublisher 스코프를 이미 받으므로 로컬 작업은 OAuth 로 된다.
    requirement: "optional",
    group: "core",
    file: "~/.mimi-seed/play-service-account.json",
    fallbackOn: ["oauth"],
    fix: "mimi-seed auth playstore",
    setup: { kind: "mcp-bin", bin: "mimi-seed-playstore-auth" },
    obtain: {
      ko: [
        "로컬에서 쓸 거면 **필요 없다** — Google OAuth 로 대부분의 Play 작업이 된다.",
        "CI/헤드리스(브라우저 없는 환경)에서만 필요:",
        "  1. GCP Console → IAM & Admin → 서비스 계정 → 키 → 새 키 만들기 → JSON",
        "  2. Play Console → 설정 → 사용자 및 권한 → 그 서비스 계정 이메일을 초대",
        "  3. 권한 전파에 ~5분 걸린다. 그 전엔 403 이 뜨는 게 정상이다.",
        "Claude 에게 `setup_playstore_connection` 을 시키면 1번을 자동화해준다.",
      ],
      en: [
        "Working locally? You **don't need this** — your Google OAuth login covers most Play work.",
        "Only needed in CI / headless environments (no browser):",
        "  1. GCP Console → IAM & Admin → Service Accounts → Keys → Add key → Create new key → JSON",
        "  2. Play Console → Settings → Users and permissions → invite that service account's email",
        "  3. The grant takes ~5 min to propagate. Until then a 403 is expected, not a bug.",
        "Ask Claude to run `setup_playstore_connection` and step 1 is done for you.",
      ],
    },
    docsAnchor: "play-service-account",
    note: {
      ko: "선택 — 로컬은 OAuth 로 가능, CI/헤드리스는 필수",
      en: "optional — OAuth covers local; required for CI / headless",
    },
    detect: (home) => ({ present: hasPlaySa(home) }),
  },
  {
    id: "bigquery",
    label: {
      ko: "BigQuery 서비스 계정",
      en: "BigQuery service account",
    },
    requirement: "optional",
    group: "core",
    file: "~/.mimi-seed/bigquery-service-account.json",
    fallbackOn: ["oauth"],
    fix: "mimi-seed auth bigquery",
    setup: { kind: "mcp-bin", bin: "mimi-seed-bigquery-auth" },
    obtain: {
      ko: [
        "OAuth 로도 동작하지만, Workspace 재인증 정책(invalid_rapt)에 막히는 환경이면 서비스 계정이 필요하다.",
        "GCP Console → IAM & Admin → 서비스 계정 → 키 → 새 키 만들기 → JSON",
        "그 서비스 계정에 IAM 역할을 **직접** 부여해야 한다 (자동으로 안 된다):",
        "  • roles/bigquery.jobUser    (쿼리 실행)",
        "  • roles/bigquery.dataViewer (데이터셋 읽기)",
      ],
      en: [
        "OAuth works too — a service account only matters if Workspace reauth policy (invalid_rapt) keeps blocking you.",
        "GCP Console → IAM & Admin → Service Accounts → Keys → Add key → Create new key → JSON",
        "You must grant that service account these IAM roles **yourself** (nothing does it for you):",
        "  • roles/bigquery.jobUser    (run queries)",
        "  • roles/bigquery.dataViewer (read datasets)",
      ],
    },
    docsAnchor: "bigquery",
    note: {
      ko: "선택 — OAuth 폴백 가능",
      en: "optional — falls back to OAuth",
    },
    detect: (home) => ({ present: anyFileStarting(home, "bigquery") }),
  },
  {
    id: "github",
    label: {
      ko: "GitHub Actions",
      en: "GitHub Actions",
    },
    requirement: "optional",
    group: "ci",
    file: "~/.mimi-seed/ci.json",
    fix: "mimi-seed auth ci",
    setup: { kind: "cli", handler: "github" },
    obtain: {
      ko: [
        "GitHub → Settings → Developer settings → Personal access tokens",
        "⚠️ 스코프 **`repo` 와 `workflow` 를 둘 다** 체크해야 한다.",
        "   `workflow` 가 없으면 워크플로 dispatch 가 403 으로 막힌다.",
        "그 외: owner(조직/사용자) · repo 이름. GitHub Enterprise 면 host URL 도.",
      ],
      en: [
        "GitHub → Settings → Developer settings → Personal access tokens",
        "⚠️ Check **both the `repo` and `workflow`** scopes.",
        "   Without `workflow`, dispatching a workflow fails with 403 (reading still works).",
        "Also: owner (org/user) · repo name. Plus the host URL on GitHub Enterprise.",
      ],
    },
    docsAnchor: "ci-github-gitlab",
    detect: (home) => ciDetect(home, "github"),
  },
  {
    id: "gitlab",
    label: {
      ko: "GitLab CI",
      en: "GitLab CI",
    },
    requirement: "optional",
    group: "ci",
    file: "~/.mimi-seed/ci.json",
    fix: "mimi-seed auth ci",
    setup: { kind: "cli", handler: "gitlab" },
    obtain: {
      ko: [
        "GitLab → 사용자 설정 → Access Tokens → `api` 스코프로 발급 (glpat-…)",
        "그 외: namespace/group · 프로젝트 이름. self-hosted 면 URL 도.",
      ],
      en: [
        "GitLab → User settings → Access tokens → issue one with the `api` scope (glpat-…)",
        "Also: namespace/group · project name. Plus the URL if self-hosted.",
      ],
    },
    docsAnchor: "ci-github-gitlab",
    detect: (home) => ciDetect(home, "gitlab"),
  },
  {
    id: "jenkins",
    label: {
      ko: "Jenkins",
      en: "Jenkins",
    },
    requirement: "optional",
    group: "ci",
    file: "~/.mimi-seed/jenkins.json",
    fix: "mimi-seed auth jenkins",
    setup: { kind: "mcp-bin", bin: "mimi-seed-jenkins-auth" },
    obtain: {
      ko: [
        "Jenkins → [사용자 이름] → 설정 → API Token → \"Add new Token\"",
        "비밀번호가 아니라 **API Token** 이다.",
        "로컬 Jenkins 가 없어도 회사/원격 서버 URL 을 그대로 쓰면 된다.",
      ],
      en: [
        "Jenkins → [your name] → Configure → API Token → \"Add new Token\"",
        "That is an **API token**, not your password.",
        "No local Jenkins needed — a company or remote server URL works just as well.",
      ],
    },
    docsAnchor: "jenkins",
    detect: (home) => {
      const cfg = readJson<{ url?: string }>(home, "jenkins.json");
      return cfg?.url ? { present: true, detail: cfg.url } : { present: false };
    },
  },
  {
    id: "googleads",
    label: {
      ko: "Google Ads",
      en: "Google Ads",
    },
    requirement: "optional",
    group: "marketing",
    file: "~/.mimi-seed/google-ads.json",
    fix: "mimi-seed auth googleads",
    setup: { kind: "mcp-bin", bin: "mimi-seed-googleads-auth" },
    obtain: {
      ko: [
        "Google Ads → 도구 및 설정 → 설정 → API 센터 → Developer Token 발급",
        "⚠️ 최초 발급 토큰은 '테스트' 등급이다. 실계정 데이터를 보려면 **승인 심사**를 통과해야 하고,",
        "   심사에는 시간이 걸린다 (즉시 발급되지 않는다).",
        "그 외: Customer ID (예: 123-456-7890). MCC 를 쓰면 관리자 계정 ID 도.",
        "인증 자체는 Google OAuth 의 `adwords` 스코프를 탄다 — 옛 토큰이면 재로그인이 필요할 수 있다.",
      ],
      en: [
        "Google Ads → Tools and settings → Setup → API Center → apply for a developer token",
        "⚠️ The token you get immediately is 'test' tier. Reaching real account data requires Google to **approve**",
        "   your application, and that takes time (it is not instant).",
        "Also: your Customer ID (e.g. 123-456-7890), plus the manager (MCC) account ID if you use one.",
        "Auth itself rides on Google OAuth's `adwords` scope — an older token may need a re-login.",
      ],
    },
    docsAnchor: "google-ads",
    detect: (home) => {
      const cfg = readJson<{ customerId?: string }>(home, "google-ads.json");
      return cfg?.customerId ? { present: true, detail: cfg.customerId } : { present: false };
    },
  },
  {
    id: "facebook",
    label: {
      ko: "Facebook 페이지",
      en: "Facebook Page",
    },
    requirement: "optional",
    group: "marketing",
    file: "~/.mimi-seed/facebook.json",
    fix: "mimi-seed auth facebook",
    setup: { kind: "mcp-bin", bin: "mimi-seed-social-auth", args: ["facebook"] },
    obtain: {
      ko: [
        "Meta 개발자 앱 + 대상 페이지의 관리자 권한이 먼저 필요하다.",
        "Graph API Explorer → 권한 pages_show_list, pages_manage_posts, pages_read_engagement",
        "→ User Token 생성 → /me/accounts 호출 → 그 페이지의 access_token (EAA…)",
        "long-lived 토큰을 권장한다 (약 60일).",
      ],
      en: [
        "You need a Meta developer app and admin rights on the target Page first.",
        "Graph API Explorer → permissions pages_show_list, pages_manage_posts, pages_read_engagement",
        "→ generate a User token → call /me/accounts → copy that Page's access_token (EAA…)",
        "Prefer a long-lived token (~60 days).",
      ],
    },
    docsAnchor: "facebook",
    detect: (home) => detectSocialToken(home, "facebook.json", "pageId", "pageAccessToken"),
  },
  {
    id: "instagram",
    label: {
      ko: "Instagram",
      en: "Instagram",
    },
    requirement: "optional",
    group: "marketing",
    file: "~/.mimi-seed/instagram.json",
    fix: "mimi-seed auth instagram",
    setup: { kind: "mcp-bin", bin: "mimi-seed-social-auth", args: ["instagram"] },
    obtain: {
      ko: [
        "long-lived 토큰 두 형식 모두 지원한다 (자동 감지):",
        "  • IGAA… — Instagram Login (Meta 신규 방식, Facebook 페이지 불필요)",
        "  • EAA…  — Facebook Login (IG **비즈니스** 계정이 FB 페이지에 연결돼 있어야 함)",
        "토큰 수명은 약 60일이다.",
      ],
      en: [
        "Both long-lived token shapes are supported (auto-detected):",
        "  • IGAA… — Instagram Login (Meta's newer path, no Facebook Page required)",
        "  • EAA…  — Facebook Login (needs an Instagram **Business** account linked to a FB Page)",
        "Tokens last about 60 days.",
      ],
    },
    docsAnchor: "instagram",
    detect: (home) => detectSocialToken(home, "instagram.json", "userId", "accessToken"),
  },
  {
    id: "threads",
    label: {
      ko: "Threads",
      en: "Threads",
    },
    requirement: "optional",
    group: "marketing",
    file: "~/.mimi-seed/threads.json",
    fix: "mimi-seed auth threads",
    setup: { kind: "mcp-bin", bin: "mimi-seed-social-auth", args: ["threads"] },
    obtain: {
      ko: [
        "Instagram 과 **별개 계정·별개 토큰**이다 (Threads Graph API).",
        "developers.facebook.com → 앱 → Threads API use case 추가",
        "→ 권한 threads_basic, threads_content_publish",
        "→ Threads 로그인으로 authorize → long-lived 토큰 교환 (약 60일).",
        "userId 는 토큰에서 자동 조회된다.",
      ],
      en: [
        "A **separate account and token** from Instagram (Threads Graph API).",
        "developers.facebook.com → your app → add the Threads API use case",
        "→ permissions threads_basic, threads_content_publish",
        "→ authorize with Threads login → exchange for a long-lived token (~60 days).",
        "userId is looked up from the token.",
      ],
    },
    docsAnchor: "threads",
    detect: (home) => detectSocialToken(home, "threads.json", "userId", "accessToken"),
  },
  {
    id: "anthropic",
    label: {
      ko: "ANTHROPIC_API_KEY",
      en: "ANTHROPIC_API_KEY",
    },
    requirement: "optional",
    group: "marketing",
    fix: "export ANTHROPIC_API_KEY=sk-ant-…",
    setup: { kind: "env", envVar: "ANTHROPIC_API_KEY" },
    obtain: {
      ko: [
        "Anthropic Console (console.anthropic.com) → API Keys 에서 발급.",
        "환경변수로만 읽는다 — 설정 명령이 따로 없다.",
        "없어도 된다: `mimi-seed notes` 는 AI 없이 커밋 목록 기반으로 동작한다.",
      ],
      en: [
        "Anthropic Console (console.anthropic.com) → API Keys.",
        "Read from the environment only — there is no setup command.",
        "Optional: without it, `mimi-seed notes` still works, formatting your commits instead of writing prose.",
      ],
    },
    docsAnchor: "anthropic-api-key",
    note: {
      ko: "선택 — AI 릴리스 노트/리뷰 답변 생성용",
      en: "optional — for AI-drafted release notes / review replies",
    },
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
    const found = detected.get(spec.id);
    // 만료됐거나 7일 안에 만료되는 토큰은 setup 이 알아서 재연결 대상으로 올린다.
    if (found?.freshness === "expired" || found?.freshness === "expiring") return true;
    if (found?.present) return false; // 이미 연결됨 → 건너뜀
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
