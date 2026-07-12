// CLI 출력 다국어화.
//
// 규칙 3가지:
//  1. `ko` 카탈로그가 **원본**이고, `en` 은 `typeof ko` 를 만족해야 한다 — 키를 빠뜨리면 컴파일이 깨진다.
//  2. 문자열이 아니라 **함수**로 두면 파라미터를 받는다 (`t().setup.planCount(3)`).
//  3. 언어는 호출 시점에 읽는다 (`t()`), 모듈 로드 시점이 아니다 — 마법사가 도중에 언어를 바꿔도 반영된다.
//
// MCP 도구의 description 은 여기서 다루지 않는다. 그건 사람이 아니라 LLM 이 읽는 인터페이스라,
// 번역하면 도구 선택 품질이 흔들린다.

import { resolveLang, type Lang } from "./settings.js";

/**
 * 파일별 로컬 카탈로그를 만든다.
 *
 * 온보딩 공통 문구(setup/doctor/auth/lang)는 아래 `t()` 의 전역 카탈로그에 있지만, 명령마다
 * 자기만 쓰는 문구는 그 파일 안에 두는 게 낫다 — i18n.ts 가 수천 줄로 부풀지 않고, 문구를
 * 고칠 때 그 명령 파일만 열면 된다. (mcp-server 의 setup bin 들도 같은 패턴.)
 *
 *   const M = catalog(
 *     { title: "배포", done: (n: number) => `${n}개 완료` },
 *     { title: "Deploy", done: (n: number) => `${n} done` },
 *   );
 *   log(M().title);
 *
 * `en` 은 `ko` 와 같은 타입이어야 하므로, 키를 빠뜨리면 **컴파일이 깨진다**.
 */
export function catalog<T extends object>(ko: T, en: NoInfer<T>): () => T {
  return () => (resolveLang() === "en" ? (en as T) : ko);
}

const ko = {
  common: {
    yes: "y",
    optional: "선택",
    required: "필수",
    skip: "건너뜀",
    cancelled: "취소됨",
    unknownCommand: (cmd: string) => `알 수 없는 명령: ${cmd}`,
    error: (msg: string) => `오류: ${msg}`,
    checkWith: "점검: mimi-seed doctor",
  },

  lang: {
    ask: "  언어를 선택해줘  [1] 한국어  [2] English  (엔터=한국어): ",
    saved: (l: Lang) => `  ✅ 언어: ${l === "ko" ? "한국어" : "English"}  (나중에 바꾸기: mimi-seed lang en)`,
    usage: `${"mimi-seed lang"} — CLI 출력 언어

  mimi-seed lang        현재 언어 표시
  mimi-seed lang ko     한국어
  mimi-seed lang en     English

환경변수 MIMI_SEED_LANG 가 있으면 그게 우선합니다.`,
    current: (l: Lang) => `현재 언어: ${l === "ko" ? "한국어 (ko)" : "English (en)"}`,
    invalid: (v: string) => `알 수 없는 언어: ${v}  (ko 또는 en)`,
  },

  setup: {
    title: "mimi-seed setup",
    platformsDetected: (p: string) => `  감지된 플랫폼: ${p}`,
    statusTitle: "연결 상태",
    statusDir: "(~/.mimi-seed)",
    groupCore: "핵심",
    groupCi: "빌드 / CI",
    groupMarketing: "마케팅 · AI",
    fallbackWorking: "폴백으로 동작 중",
    missingRequired: "  필수 항목 누락:",
    cannotInteract: "  ✗ 이 자격증명은 대화형 입력이 필요해서 여기서는 설정할 수 없어:",
    cannotInteractHint: "    터미널에서 실행해줘 (Git Bash 등 TTY 미감지 환경이면 --interactive).",
    runInTerminal: "  대화형으로 연결하려면 터미널에서:  mimi-seed setup",
    onlyAlreadyDone: "  ✅ 요청한 항목은 이미 연결돼 있어.",
    onlyReconnectHint: "     다시 설정하려면: mimi-seed setup --reconnect <id>",
    allDone: "  ✅ 연결할 게 더 없어. 다 됐다.",
    planCount: (n: number) => `  ${n}개 항목을 순서대로 물어볼게. 언제든 s=건너뛰기, q=종료.`,
    prompt: "  [c] 연결  [s] 건너뛰기  [?] 이건 어떻게 구하나요  [q] 종료 : ",
    promptInvalid: "  c / s / ? / q 중에서 골라줘.",
    quit: "  중단했어. 이어서 하려면 다시:  mimi-seed setup",
    skipped: (fix: string) => `  건너뜀. 나중에: ${fix}`,
    obtainTitle: (label: string) => `  ${label} — 미리 준비할 것`,
    obtainMore: (anchor: string) => `    자세히: docs/credentials.md#${anchor}`,
    neededFor: (platform: string) => `(${platform} 배포에 필요)`,
    binFailed: (label: string, code: number, fix: string) =>
      `  ⚠ ${label} 설정이 완료되지 않았어 (exit ${code}). 나중에 다시: ${fix}`,
    verifying: "  🔎 토큰 검증 중...",
    verifyFailed: (reason: string) => `  ❌ 토큰 검증 실패: ${reason}`,
    notSaved: (fix: string) => `     저장하지 않았어. 다시: ${fix}`,
    ciSaved: (label: string, who: string) => `  ✅ ${label} 연결됨${who} → ~/.mimi-seed/ci.json`,
    runSeparately: (cmd: string) => `  이건 별도 명령으로 실행해줘:  ${cmd}`,
    envVar: "  환경변수로 설정하는 항목이야:",
    pressEnter: "  (엔터를 누르면 계속) ",
    stillMissing: "  아직 필수 항목이 남아 있어:",
    requiredDone: "  ✅ 필수 연결 완료.",
    nextSteps: "     점검: mimi-seed doctor   ·   배포: mimi-seed deploy",
  },

  doctor: {
    title: "mimi-seed doctor",
    secAuth: "인증",
    secCreds: "로컬 자격증명 (~/.mimi-seed)",
    secEnv: "로컬 환경",
    secApps: "앱 감지",
    noToken: "Mimi Seed 토큰 없음",
    noTokenFix: "`mimi-seed init` 실행 필요",
    tokenSaved: "토큰 저장됨",
    endpoint: "엔드포인트",
    ciMode: "CI 모드",
    ciModeDetail: "MIMI_SEED_TOKEN 환경변수 사용 중",
    tokenInvalid: "토큰 검증 실패",
    serverOk: "Mimi Seed 서버 연결됨",
    appCount: (n: number) => `앱 ${n}개`,
    unknownService: (id: string) => `${id} (알 수 없는 서비스)`,
    credsHint: "  전부 연결하기: mimi-seed setup   ·   OAuth 신선도: mimi-seed auth status\n",
    nodeTooOld: (v: string) => `${v} — v20 이상 필요 (.nvmrc 참고)`,
    gitRepo: "Git 저장소",
    gitTag: (t: string) => `최신 태그: ${t}`,
    gitCommits: (n: number) => `커밋 ${n}개`,
    noGit: "Git 저장소 없음",
    noGitDetail: "mimi-seed notes 사용 불가",
    noApp: "앱 감지 없음",
    noAppDetail: "app.json / build.gradle / Info.plist 없음",
    unnamed: "(이름 미상)",
    requirements: (proj: string) => `${proj} 요구사항 (.mimi-seed.json)`,
    thisProject: "이 프로젝트",
  },

  auth: {
    title: "mimi-seed auth — 로컬 자격증명 인증/관리",
    statusTitle: "로컬 자격증명 상태",
    connectAll: "\n  한 번에 연결: mimi-seed setup",
    unknownSub: (sub: string) => `알 수 없는 auth 서브명령: ${sub}`,
    npxFailed: (cmd: string, msg: string) => `\n  ❌ ${cmd} 실행 실패: ${msg}\n`,
  },
} as const;

// ko 가 `as const` 라 값들이 **리터럴 타입**이다 — 그대로 쓰면 en 은 ko 와 같은 문자열만 넣을 수 있다.
// 리터럴은 string 으로 넓히고, 함수 시그니처는 그대로 유지한다 (키/파라미터 검사는 계속 살아 있다).
type Widen<T> = T extends string ? string : T;

type Catalog = {
  [K in keyof typeof ko]: { [P in keyof (typeof ko)[K]]: Widen<(typeof ko)[K][P]> };
};

// en 은 ko 와 **완전히 같은 키/시그니처**여야 한다 (빠지면 컴파일 에러).
const en: Catalog = {
  common: {
    yes: "y",
    optional: "optional",
    required: "required",
    skip: "skipped",
    cancelled: "Cancelled",
    unknownCommand: (cmd: string) => `Unknown command: ${cmd}`,
    error: (msg: string) => `Error: ${msg}`,
    checkWith: "Check with: mimi-seed doctor",
  },

  lang: {
    ask: "  Choose a language  [1] 한국어  [2] English  (Enter = 한국어): ",
    saved: (l: Lang) =>
      `  ✅ Language: ${l === "ko" ? "한국어" : "English"}  (change later: mimi-seed lang ko)`,
    usage: `mimi-seed lang — CLI output language

  mimi-seed lang        show current language
  mimi-seed lang ko     한국어
  mimi-seed lang en     English

MIMI_SEED_LANG takes precedence when set.`,
    current: (l: Lang) => `Current language: ${l === "ko" ? "한국어 (ko)" : "English (en)"}`,
    invalid: (v: string) => `Unknown language: ${v}  (use ko or en)`,
  },

  setup: {
    title: "mimi-seed setup",
    platformsDetected: (p: string) => `  Detected platforms: ${p}`,
    statusTitle: "Connection status",
    statusDir: "(~/.mimi-seed)",
    groupCore: "Core",
    groupCi: "Build / CI",
    groupMarketing: "Marketing · AI",
    fallbackWorking: "working via fallback",
    missingRequired: "  Missing required:",
    cannotInteract: "  ✗ These need interactive input and cannot be set up here:",
    cannotInteractHint:
      "    Run it in a terminal (add --interactive if your shell hides the TTY, e.g. Git Bash).",
    runInTerminal: "  To connect interactively, run:  mimi-seed setup",
    onlyAlreadyDone: "  ✅ What you asked for is already connected.",
    onlyReconnectHint: "     To redo it: mimi-seed setup --reconnect <id>",
    allDone: "  ✅ Nothing left to connect. You're set.",
    planCount: (n: number) => `  I'll walk you through ${n} item(s). s = skip, q = quit, anytime.`,
    prompt: "  [c] connect  [s] skip  [?] how do I get this  [q] quit : ",
    promptInvalid: "  Please choose c / s / ? / q.",
    quit: "  Stopped. To pick up where you left off:  mimi-seed setup",
    skipped: (fix: string) => `  Skipped. Later: ${fix}`,
    obtainTitle: (label: string) => `  ${label} — what to get first`,
    obtainMore: (anchor: string) => `    Details: docs/credentials.md#${anchor}`,
    neededFor: (platform: string) => `(needed to ship to ${platform})`,
    binFailed: (label: string, code: number, fix: string) =>
      `  ⚠ ${label} was not completed (exit ${code}). Try again later: ${fix}`,
    verifying: "  🔎 Verifying token...",
    verifyFailed: (reason: string) => `  ❌ Token verification failed: ${reason}`,
    notSaved: (fix: string) => `     Nothing was saved. Retry: ${fix}`,
    ciSaved: (label: string, who: string) => `  ✅ ${label} connected${who} → ~/.mimi-seed/ci.json`,
    runSeparately: (cmd: string) => `  Run this one separately:  ${cmd}`,
    envVar: "  This one is set through an environment variable:",
    pressEnter: "  (press Enter to continue) ",
    stillMissing: "  Still missing, and required:",
    requiredDone: "  ✅ All required credentials connected.",
    nextSteps: "     Check: mimi-seed doctor   ·   Ship: mimi-seed deploy",
  },

  doctor: {
    title: "mimi-seed doctor",
    secAuth: "Account",
    secCreds: "Local credentials (~/.mimi-seed)",
    secEnv: "Environment",
    secApps: "App detection",
    noToken: "No Mimi Seed token",
    noTokenFix: "run `mimi-seed init`",
    tokenSaved: "Token stored",
    endpoint: "Endpoint",
    ciMode: "CI mode",
    ciModeDetail: "using MIMI_SEED_TOKEN",
    tokenInvalid: "Token rejected",
    serverOk: "Connected to Mimi Seed",
    appCount: (n: number) => `${n} app(s)`,
    unknownService: (id: string) => `${id} (unknown service)`,
    credsHint:
      "  Connect everything: mimi-seed setup   ·   OAuth freshness: mimi-seed auth status\n",
    nodeTooOld: (v: string) => `${v} — v20+ required (see .nvmrc)`,
    gitRepo: "Git repository",
    gitTag: (t: string) => `latest tag: ${t}`,
    gitCommits: (n: number) => `${n} commit(s)`,
    noGit: "Not a git repository",
    noGitDetail: "mimi-seed notes is unavailable",
    noApp: "No app detected",
    noAppDetail: "no app.json / build.gradle / Info.plist",
    unnamed: "(unnamed)",
    requirements: (proj: string) => `${proj} requirements (.mimi-seed.json)`,
    thisProject: "This project",
  },

  auth: {
    title: "mimi-seed auth — local credential setup",
    statusTitle: "Local credential status",
    connectAll: "\n  Connect everything at once: mimi-seed setup",
    unknownSub: (sub: string) => `Unknown auth subcommand: ${sub}`,
    npxFailed: (cmd: string, msg: string) => `\n  ❌ Failed to run ${cmd}: ${msg}\n`,
  },
};

const CATALOGS: Record<Lang, Catalog> = { ko, en };

/** 호출 시점에 언어를 읽는다 — 모듈 로드 시점이 아니다. */
export function t(): Catalog {
  return CATALOGS[resolveLang()];
}

export type { Lang };
