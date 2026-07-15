// Mimi Seed CLI

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import kleur from "kleur";
import open from "open";
import { detectHints, hasAnyProjectSignal } from "./detect.js";
import { awaitHandshake } from "./handshake.js";
import { mcpCall } from "./mcp-client.js";
import {
  readConfig,
  writeConfig,
  deleteConfig,
  getEffectiveConfig,
  CONFIG_LOCATION,
  MimiSeedConfig,
} from "./config.js";
import { cmdDoctor } from "./doctor.js";
import { cmdCheck } from "./check.js";
import { cmdNotes } from "./notes.js";
import { cmdReview } from "./review.js";
import { cmdAuth } from "./auth.js";
import { cmdSetup } from "./setup.js";
import { cmdLang } from "./lang.js";
import { cmdFirebase, cmdAdmob, cmdGa4 } from "./cloud.js";
import { cmdDeploy } from "./deploy.js";
import { cmdRestart } from "./mcp-restart.js";
import { printMcpSetup, writeCodexMcpConfig, claudeMcpAddCommand } from "./mcp-config.js";
import { ensureReleaseManifest } from "./release-manifest.js";
import { catalog, t } from "./i18n.js";

const DEFAULT_WEB_BASE = process.env.MIMI_SEED_WEB_BASE ?? "https://mimi-seed.pryzm.gg";
const DEFAULT_MCP_ENDPOINT = `${DEFAULT_WEB_BASE}/api/mcp`;

// 이 파일에서만 쓰는 문구. 공통 문구(common.error 등)는 i18n.ts 의 t() 에 있다.
// `usage` / `help` 는 kleur 가 섞여 있지만 모듈 로드 시점에 한 번 만들어 두면 되므로 그대로 둔다.
const M = catalog(
  {
    noProjectSignal: "⚠ package.json / app.json / android / ios 를 찾지 못했습니다. 그래도 진행합니다.",
    detecting: "🔍 앱 감지 중...",
    noAppDetected: "감지된 앱 없음. 웹에서 수동 등록 가능.",
    unnamed: "(이름 미상)",
    ciMode: "CI 모드: MIMI_SEED_TOKEN 사용",
    syncFailed: (text: string) => "등록 실패: " + text,
    manifest: (created: boolean) => `  릴리즈 노트 SSOT: ${created ? "생성" : "확인"} docs/releases.json`,
    doneCi: "✓ 완료 (CI 모드)",
    waitingLogin: "🔐 브라우저에서 로그인 대기...",
    connectFailed: (msg: string) => "연결 실패: " + msg,
    tokenReceived: "✓ 토큰 수신",
    saved: (location: string) => `  저장됨: ${location}`,
    registering: "🔄 앱 등록 중...",
    claudeAgent: "  Claude 에이전트 설정: .claude/mimi-seed.md",
    codexAgent: "  Codex 에이전트 설정: AGENTS.md",
    ready: "✓ 준비 완료.",
    askLike: "Claude Code 또는 Codex에서 이렇게 물어보세요:",
    ask1: '  "내 앱 출시 준비됐어?"',
    ask2: '  "릴리즈 노트 써줘"',
    ask3: '  "등록된 앱 목록 보여줘"',
    dashboard: (url: string) => `대시보드: ${url}`,

    localTitle: "── 로컬 MCP 추가 설정 (--local) ──",
    localIntro:
      "원격 MCP(PAT, 읽기·진단)는 위에서 끝. 로컬 MCP는 Google OAuth로 스토어 쓰기 도구 전체를 직접 실행합니다 (Node 20+).",
    localStep1: "1) Google 로그인 (Firebase / AdMob / Play / Ads):",
    localStep2: "2) 로컬 MCP 서버 등록 (원격 'mimi-seed' 와 별개):",
    localCodexHint:
      '   Codex: ~/.codex/config.toml 에 [mcp_servers.mimi-seed-local] command="npx", args=["-y","@yoonion/mimi-seed-mcp"]',
    localStep3: "3) 나머지 계정 연결 (App Store / Play / Jenkins / CI / 소셜 …):",
    localSetupHint: "   각 항목에서 [?] 를 누르면 토큰 발급 방법을 알려줍니다.",

    notConnected: "연결된 Mimi Seed 계정이 없습니다. `mimi-seed init` 실행.",
    statusTitle: "Mimi Seed 연결 상태",
    statusToken: (prefix: string, date: string) => `  토큰: ${prefix}…  (${date})`,
    statusEndpoint: (endpoint: string) => `  엔드포인트: ${endpoint}`,
    appList: "📋 앱 목록:",
    listFailed: (text: string) => "조회 실패: " + text,

    logoutDone: "✓ 로컬 설정 삭제 완료.",
    logoutRevoke: "웹에서 토큰 해지: /workspace/api-tokens",

    codexWritten: "✓ Codex MCP 설정 완료 (mimi-seed-remote, HTTP)",
    codexWriteWarn: "  ⚠ 토큰은 config 에 평문 저장하지 않습니다 — MIMI_SEED_TOKEN 환경변수에 PAT 를 넣어야 인증됩니다.",
    codexVerify: "Codex를 새로 열고 `/mcp` 또는 `codex mcp list`로 확인하세요.",
    codexTitle: "Codex MCP 등록",
    codexAuto: "자동 등록:",
    codexManual: "수동 등록 예시 (~/.codex/config.toml) — 토큰은 MIMI_SEED_TOKEN 환경변수로:",
    claudeTitle: "Claude Code MCP 등록 — 아래 한 줄을 그대로 실행하세요:",
    claudeWarn:
      "  ⚠ 실제 토큰이 포함된 명령입니다 (셸 히스토리에 남음). 토큰은 ~/.mimi-seed/config.json 에도 저장되어 있습니다.",

    // 명령별 상세 사용법 (SSOT). `mimi-seed <command> --help` 와 overview 가 공유.
    usage: {
      init: `${kleur.bold("mimi-seed init")} — 현재 프로젝트를 Mimi Seed에 연결

앱 자동 감지(Expo/Gradle/Info.plist/pbxproj) → 브라우저 PAT 발급(원격 MCP) → 앱 등록
+ .claude/mimi-seed.md, AGENTS.md, docs/releases.json 생성/확인.

옵션:
  --local   추가로 Google OAuth 로그인 + 로컬 MCP(스토어 쓰기 도구 전체) 등록 안내`,
      setup: `${kleur.bold("mimi-seed setup")} — 가진 계정을 한 번에 연결 (안내형 마법사)

연결 상태를 먼저 보여주고, 아직 연결되지 않은 것만 순서대로 물어본다.
각 항목에서 [?] 를 누르면 "그 토큰을 어디서 어떻게 발급받는지"를 알려준다.
이미 연결된 항목은 건너뛰므로, 중간에 그만두고 나중에 다시 실행해도 된다.

옵션:
  --only <ids>        지정한 자격증명만 (쉼표 구분: oauth,appstore,jenkins …)
  --reconnect <ids>   이미 연결돼 있어도 다시 설정
  --platform android,ios   플랫폼 강제 지정 (기본: 프로젝트에서 자동 감지)
  --yes, -y           아무것도 묻지 않고 상태표만 출력
  --non-interactive   위와 동일 (CI 용)
  --fail-on-missing   필수 자격증명이 없으면 exit 1 (CI 게이트)

${kleur.dim("비TTY / CI 환경에서는 프롬프트 없이 상태표만 출력한다.")}`,
      lang: `${kleur.bold("mimi-seed lang")} — CLI 출력 언어 (한국어 / English)

  mimi-seed lang        현재 언어 표시
  mimi-seed lang ko     한국어 (기본)
  mimi-seed lang en     English

${kleur.dim("~/.mimi-seed/settings.json 에 저장됩니다. 환경변수 MIMI_SEED_LANG 가 있으면 그게 우선합니다.")}
${kleur.dim("setup 마법사가 첫 실행 때 물어보므로 보통은 직접 칠 일이 없습니다.")}`,
      status: `${kleur.bold("mimi-seed status")} — 연결 상태 + 등록 앱 목록. 옵션 없음.`,
      doctor: `${kleur.bold("mimi-seed doctor")} — 환경 진단 (토큰·Node·Git·프로젝트·CI). 옵션 없음.`,
      logout: `${kleur.bold("mimi-seed logout")} — 로컬 설정(config.json) 삭제. 옵션 없음.`,
      restart: `${kleur.bold("mimi-seed restart")} — MCP 서버 프로세스 재시작 (기본: mimi-seed)

  mimi-seed restart [server-name]`,
      notes: `${kleur.bold("mimi-seed notes")} — 릴리즈 노트 생성 (git log → AI → 마켓 적용)

옵션:
  --from <ref>        시작 커밋/태그 (기본: 최신 태그)
  --to <ref>          끝 커밋 (기본: HEAD)
  --locale ko,en-US   대상 로케일 (쉼표 구분)
  --apply             생성 후 스토어에 바로 적용
  --no-interactive    CI 모드 (프롬프트 없음)
  --limit <n>         최대 커밋 수 (기본: 30)`,
      check: `${kleur.bold("mimi-seed check")} — 출시 전 Readiness 점검

옵션:
  --app <id>          앱 ID 지정
  --fail-on-blocker   블로커 있으면 exit 1 (CI용)`,
      review: `${kleur.bold("mimi-seed review")} — 리뷰 답변 AI 초안 생성 및 Play Store 게시

옵션:
  --text <내용>       리뷰 원문 (미입력 시 대화형 프롬프트)
  --rating <1-5>      별점
  --tone <tone>       friendly / professional / empathetic / brief (기본: friendly)
  --language <코드>   답변 언어 (기본: ko)
  --app-name <이름>   앱 이름 (맥락용)
  --apply             답변을 Play Store에 게시
  --review-id <id>    리뷰 ID (--apply 시 필요)
  --package-name <p>  패키지명 (--apply 시 필요)
  --no-interactive    CI 모드`,
      deploy: `${kleur.bold("mimi-seed deploy")} — 앱 자동 배포 (CI 빌드 → Play Store/App Store)

옵션:
  --platform android|ios       배포 플랫폼 (기본: android)
  --app <id>                   앱 ID 지정
  --version-code <n>           빌드 번호 직접 지정 (--skip-build 와 함께)
  --from <ref>                 커밋 범위 시작 (릴리즈 노트용)
  --to <ref>                   커밋 범위 끝 (기본: HEAD)
  --language <코드>            릴리즈 노트 언어 (기본: ko-KR)
  --dry-run                    실제 배포 없이 파이프라인 테스트
  --yes, -y                    배포 확인 프롬프트 생략 (스크립트/자동화용)
  --skip-build                 CI 빌드 건너뜀 (--version-code 필수)
  --ci jenkins|github|gitlab   CI 강제 선택 (기본: auto)
  --workflow <file>            GitHub workflow 파일 (예: deploy.yml)
  --ref <branch|tag>           GitHub/GitLab 브랜치/태그 (기본: main)
  setup-jenkins / setup-github / setup-gitlab   CI 설정 대화형 등록`,
      mcp: `${kleur.bold("mimi-seed mcp")} — Claude/Codex MCP 연결

서브명령:
  mimi-seed mcp                현재 설정 + 등록 안내
  mimi-seed mcp claude         Claude Code 등록 명령 출력
  mimi-seed mcp codex          Codex 등록 안내
  mimi-seed mcp codex --write  ~/.codex/config.toml에 직접 기록 (⚠ 실제 토큰 평문 저장)`,
    },

    help: `${kleur.bold("mimi-seed")} — Claude Code/Codex에서 앱 출시 운영

${kleur.bold("명령어:")}
  ${kleur.cyan("mimi-seed init")}        현재 프로젝트를 Mimi Seed에 연결
  ${kleur.cyan("mimi-seed setup")}       가진 계정을 한 번에 연결 (안내형 마법사)
  ${kleur.cyan("mimi-seed lang")}        출력 언어 (ko / en)
  ${kleur.cyan("mimi-seed status")}      연결 상태 + 등록 앱 목록
  ${kleur.cyan("mimi-seed auth")}        자격증명 개별 인증 (Google / App Store / Play / Jenkins / CI …)
  ${kleur.cyan("mimi-seed firebase")}    Firebase 앱 생성·config 다운로드·GA4 링크
  ${kleur.cyan("mimi-seed admob")}       AdMob 계정·앱·광고단위 조회 및 생성
  ${kleur.cyan("mimi-seed ga4")}         GA4 property·data stream 생성·조회
  ${kleur.cyan("mimi-seed doctor")}      환경 진단 (토큰·Git·프로젝트·CI 체크)
  ${kleur.cyan("mimi-seed check")}       출시 전 Readiness 점검
  ${kleur.cyan("mimi-seed notes")}       릴리즈 노트 생성 (git log → AI → 마켓 적용)
  ${kleur.cyan("mimi-seed review")}      리뷰 답변 AI 초안 생성 및 Play Store 게시
  ${kleur.cyan("mimi-seed deploy")}      앱 자동 배포 (CI → Play Store/App Store)
  ${kleur.cyan("mimi-seed mcp")}         Claude/Codex MCP 연결 안내 및 Codex 설정 쓰기
  ${kleur.cyan("mimi-seed restart")}     MCP 서버 프로세스 재시작 (기본: mimi-seed)
  ${kleur.cyan("mimi-seed logout")}      로컬 설정 삭제

${kleur.dim("각 명령 상세 옵션:")} ${kleur.cyan("mimi-seed <command> --help")}

${kleur.bold("환경변수:")}
  MIMI_SEED_TOKEN     PAT 토큰 (CI/CD 무인증 모드)
  MIMI_SEED_WEB_BASE  서버 주소 (기본: https://mimi-seed.pryzm.gg)
  ANTHROPIC_API_KEY   AI 노트 생성 활성화 (선택)
  MIMI_SEED_LANG      출력 언어 강제 (ko / en) — settings.json 보다 우선
  MIMI_SEED_GOOGLE_CLIENT_ID / _SECRET
                      직접 만든 Google OAuth 클라이언트 사용 (미지정 시 로그인 때 웹 콘솔에서 받아옴)
`,
  },
  {
    noProjectSignal: "⚠ No package.json / app.json / android / ios found. Continuing anyway.",
    detecting: "🔍 Detecting apps...",
    noAppDetected: "No app detected. You can register one manually on the web.",
    unnamed: "(unnamed)",
    ciMode: "CI mode: using MIMI_SEED_TOKEN",
    syncFailed: (text: string) => "Registration failed: " + text,
    manifest: (created: boolean) =>
      `  Release notes SSOT: ${created ? "created" : "verified"} docs/releases.json`,
    doneCi: "✓ Done (CI mode)",
    waitingLogin: "🔐 Waiting for browser sign-in...",
    connectFailed: (msg: string) => "Connection failed: " + msg,
    tokenReceived: "✓ Token received",
    saved: (location: string) => `  Saved: ${location}`,
    registering: "🔄 Registering apps...",
    claudeAgent: "  Claude agent config: .claude/mimi-seed.md",
    codexAgent: "  Codex agent config: AGENTS.md",
    ready: "✓ Ready.",
    askLike: "Try asking this in Claude Code or Codex:",
    ask1: '  "Is my app ready to ship?"',
    ask2: '  "Write the release notes"',
    ask3: '  "Show my registered apps"',
    dashboard: (url: string) => `Dashboard: ${url}`,

    localTitle: "── Extra local MCP setup (--local) ──",
    localIntro:
      "The remote MCP (PAT, read + diagnostics) is done above. The local MCP runs every store write tool directly via Google OAuth (Node 20+).",
    localStep1: "1) Sign in with Google (Firebase / AdMob / Play / Ads):",
    localStep2: "2) Register the local MCP server (separate from the remote 'mimi-seed'):",
    localCodexHint:
      '   Codex: add [mcp_servers.mimi-seed-local] command="npx", args=["-y","@yoonion/mimi-seed-mcp"] to ~/.codex/config.toml',
    localStep3: "3) Connect the remaining accounts (App Store / Play / Jenkins / CI / social …):",
    localSetupHint: "   Press [?] on any item to see how to obtain that token.",

    notConnected: "No Mimi Seed account connected. Run `mimi-seed init`.",
    statusTitle: "Mimi Seed connection status",
    statusToken: (prefix: string, date: string) => `  Token: ${prefix}…  (${date})`,
    statusEndpoint: (endpoint: string) => `  Endpoint: ${endpoint}`,
    appList: "📋 Apps:",
    listFailed: (text: string) => "Lookup failed: " + text,

    logoutDone: "✓ Local config deleted.",
    logoutRevoke: "Revoke the token on the web: /workspace/api-tokens",

    codexWritten: "✓ Codex MCP configured (mimi-seed-remote, HTTP)",
    codexWriteWarn:
      "  ⚠ The token is NOT written to the config — set MIMI_SEED_TOKEN to your PAT so the remote authenticates.",
    codexVerify: "Reopen Codex and verify with `/mcp` or `codex mcp list`.",
    codexTitle: "Codex MCP registration",
    codexAuto: "Automatic:",
    codexManual: "Manual example (~/.codex/config.toml) — token via the MIMI_SEED_TOKEN env var:",
    claudeTitle: "Claude Code MCP registration — run this one line as-is:",
    claudeWarn:
      "  ⚠ This command contains the real token (it stays in your shell history). The token is also stored in ~/.mimi-seed/config.json.",

    usage: {
      init: `${kleur.bold("mimi-seed init")} — connect the current project to Mimi Seed

Auto-detects apps (Expo/Gradle/Info.plist/pbxproj) → issues a PAT in the browser (remote MCP) → registers the apps
+ creates/verifies .claude/mimi-seed.md, AGENTS.md, docs/releases.json.

Options:
  --local   also sign in with Google OAuth and show local MCP (all store write tools) setup`,
      setup: `${kleur.bold("mimi-seed setup")} — connect the accounts you have, in one pass (guided wizard)

Shows the connection status first, then asks only about what is not connected yet.
Press [?] on any item to learn where and how to obtain that token.
Already-connected items are skipped, so you can quit halfway and rerun it later.

Options:
  --only <ids>        only the given credentials (comma-separated: oauth,appstore,jenkins …)
  --reconnect <ids>   set up again even if already connected
  --platform android,ios   force the platforms (default: auto-detected from the project)
  --yes, -y           ask nothing, just print the status table
  --non-interactive   same as above (for CI)
  --fail-on-missing   exit 1 if a required credential is missing (CI gate)

${kleur.dim("In non-TTY / CI environments it prints the status table only, with no prompts.")}`,
      lang: `${kleur.bold("mimi-seed lang")} — CLI output language (한국어 / English)

  mimi-seed lang        show current language
  mimi-seed lang ko     한국어 (default)
  mimi-seed lang en     English

${kleur.dim("Stored in ~/.mimi-seed/settings.json. MIMI_SEED_LANG takes precedence when set.")}
${kleur.dim("The setup wizard asks on first run, so you rarely need to type this.")}`,
      status: `${kleur.bold("mimi-seed status")} — connection status + registered apps. No options.`,
      doctor: `${kleur.bold("mimi-seed doctor")} — environment check (token · Node · Git · project · CI). No options.`,
      logout: `${kleur.bold("mimi-seed logout")} — delete the local config (config.json). No options.`,
      restart: `${kleur.bold("mimi-seed restart")} — restart the MCP server process (default: mimi-seed)

  mimi-seed restart [server-name]`,
      notes: `${kleur.bold("mimi-seed notes")} — generate release notes (git log → AI → push to stores)

Options:
  --from <ref>        start commit/tag (default: latest tag)
  --to <ref>          end commit (default: HEAD)
  --locale ko,en-US   target locales (comma-separated)
  --apply             push to the stores right after generating
  --no-interactive    CI mode (no prompts)
  --limit <n>         max commits (default: 30)`,
      check: `${kleur.bold("mimi-seed check")} — pre-release readiness check

Options:
  --app <id>          app ID
  --fail-on-blocker   exit 1 if a blocker is found (for CI)`,
      review: `${kleur.bold("mimi-seed review")} — draft a review reply with AI and post it to the Play Store

Options:
  --text <content>    the review text (interactive prompt if omitted)
  --rating <1-5>      star rating
  --tone <tone>       friendly / professional / empathetic / brief (default: friendly)
  --language <code>   reply language (default: ko)
  --app-name <name>   app name (for context)
  --apply             post the reply to the Play Store
  --review-id <id>    review ID (required with --apply)
  --package-name <p>  package name (required with --apply)
  --no-interactive    CI mode`,
      deploy: `${kleur.bold("mimi-seed deploy")} — automated app release (CI build → Play Store/App Store)

Options:
  --platform android|ios       target platform (default: android)
  --app <id>                   app ID
  --version-code <n>           set the build number explicitly (with --skip-build)
  --from <ref>                 commit range start (for release notes)
  --to <ref>                   commit range end (default: HEAD)
  --language <code>            release notes language (default: ko-KR)
  --dry-run                    exercise the pipeline without releasing
  --yes, -y                    skip the release confirmation prompt (scripts/automation)
  --skip-build                 skip the CI build (--version-code required)
  --ci jenkins|github|gitlab   force the CI provider (default: auto)
  --workflow <file>            GitHub workflow file (e.g. deploy.yml)
  --ref <branch|tag>           GitHub/GitLab branch/tag (default: main)
  setup-jenkins / setup-github / setup-gitlab   interactive CI setup`,
      mcp: `${kleur.bold("mimi-seed mcp")} — Claude/Codex MCP connection

Subcommands:
  mimi-seed mcp                current config + setup instructions
  mimi-seed mcp claude         print the Claude Code registration command
  mimi-seed mcp codex          Codex setup instructions
  mimi-seed mcp codex --write  write straight into ~/.codex/config.toml (⚠ stores the real token in plain text)`,
    },

    help: `${kleur.bold("mimi-seed")} — app release ops from Claude Code/Codex

${kleur.bold("Commands:")}
  ${kleur.cyan("mimi-seed init")}        connect the current project to Mimi Seed
  ${kleur.cyan("mimi-seed setup")}       connect the accounts you have, in one pass (guided wizard)
  ${kleur.cyan("mimi-seed lang")}        output language (ko / en)
  ${kleur.cyan("mimi-seed status")}      connection status + registered apps
  ${kleur.cyan("mimi-seed auth")}        connect credentials one by one (Google / App Store / Play / Jenkins / CI …)
  ${kleur.cyan("mimi-seed firebase")}    create Firebase apps, download configs, link GA4
  ${kleur.cyan("mimi-seed admob")}       list and create AdMob accounts, apps, ad units
  ${kleur.cyan("mimi-seed ga4")}         create and list GA4 properties and data streams
  ${kleur.cyan("mimi-seed doctor")}      environment check (token · Git · project · CI)
  ${kleur.cyan("mimi-seed check")}       pre-release readiness check
  ${kleur.cyan("mimi-seed notes")}       generate release notes (git log → AI → push to stores)
  ${kleur.cyan("mimi-seed review")}      draft a review reply with AI and post it to the Play Store
  ${kleur.cyan("mimi-seed deploy")}      automated app release (CI → Play Store/App Store)
  ${kleur.cyan("mimi-seed mcp")}         Claude/Codex MCP setup instructions and Codex config writing
  ${kleur.cyan("mimi-seed restart")}     restart the MCP server process (default: mimi-seed)
  ${kleur.cyan("mimi-seed logout")}      delete the local config

${kleur.dim("Per-command options:")} ${kleur.cyan("mimi-seed <command> --help")}

${kleur.bold("Environment variables:")}
  MIMI_SEED_TOKEN     PAT token (headless CI/CD mode)
  MIMI_SEED_WEB_BASE  server address (default: https://mimi-seed.pryzm.gg)
  ANTHROPIC_API_KEY   enable AI note generation (optional)
  MIMI_SEED_LANG      force the output language (ko / en) — beats settings.json
  MIMI_SEED_GOOGLE_CLIENT_ID / _SECRET
                      use your own Google OAuth client (otherwise fetched from the web console at sign-in)
`,
  },
);

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

async function cmdInit(args: string[]): Promise<void> {
  const local = args.includes("--local");
  const cwd = process.cwd();
  log(kleur.bold("Mimi Seed CLI — init"));
  log(kleur.dim(cwd));
  log("");

  if (!(await hasAnyProjectSignal(cwd))) {
    log(kleur.yellow(M().noProjectSignal));
  }
  log(M().detecting);
  const hints = await detectHints(cwd);
  if (hints.length === 0) {
    log(kleur.yellow(M().noAppDetected));
  } else {
    for (const h of hints) {
      const tag = [h.packageName && `android:${h.packageName}`, h.bundleId && `ios:${h.bundleId}`]
        .filter(Boolean)
        .join("  ");
      log(`  • ${h.name ?? M().unnamed}  ${kleur.dim(tag)}`);
    }
  }
  log("");

  // CI 모드: MIMI_SEED_TOKEN이 이미 있으면 핸드셰이크 생략
  if (process.env.MIMI_SEED_TOKEN) {
    const cfg = await getEffectiveConfig();
    if (cfg && hints.length > 0) {
      log(kleur.dim(M().ciMode));
      const payload = hints.map((h) => ({ name: h.name, packageName: h.packageName, bundleId: h.bundleId }));
      const result = await mcpCall(cfg.endpoint, cfg.token, "sync_apps", { hints: payload });
      if (result.isError) {
        log(kleur.red(M().syncFailed(result.text)));
      } else {
        for (const line of result.text.split("\n")) log("  " + line);
      }
    }
    const manifest = await ensureReleaseManifest(cwd);
    log(kleur.dim(M().manifest(manifest.created)));
    log(kleur.bold(M().doneCi));
    return;
  }

  log(M().waitingLogin);
  const hostName = os.hostname().slice(0, 32);
  const name = `cli-${hostName}`;
  const { port, promise } = await awaitHandshake(5 * 60 * 1000);
  const callback = `http://127.0.0.1:${port}/cb`;
  const connectUrl = `${DEFAULT_WEB_BASE}/cli/connect?callback=${encodeURIComponent(callback)}&name=${encodeURIComponent(name)}`;
  log(kleur.dim(`  ${connectUrl}`));
  await open(connectUrl);

  let handshake;
  try {
    handshake = await promise;
  } catch (e) {
    log(kleur.red(M().connectFailed((e as Error).message)));
    process.exit(1);
  }
  log(kleur.green(M().tokenReceived));

  const cfg: MimiSeedConfig = {
    token: handshake.token,
    prefix: handshake.prefix,
    endpoint: DEFAULT_MCP_ENDPOINT,
    webBase: DEFAULT_WEB_BASE,
    createdAt: new Date().toISOString(),
  };
  await writeConfig(cfg);
  log(kleur.dim(M().saved(CONFIG_LOCATION)));
  log("");

  if (hints.length > 0) {
    log(M().registering);
    const payload = hints.map((h) => ({ name: h.name, packageName: h.packageName, bundleId: h.bundleId }));
    const result = await mcpCall(cfg.endpoint, cfg.token, "sync_apps", { hints: payload });
    if (result.isError) {
      log(kleur.red(M().syncFailed(result.text)));
    } else {
      for (const line of result.text.split("\n")) log("  " + line);
    }
    log("");
  }

  const appLines = hints.flatMap((h) => {
    const parts = [
      h.name && `  name: ${h.name}`,
      h.packageName && `  packageName: ${h.packageName}`,
      h.bundleId && `  bundleId: ${h.bundleId}`,
    ].filter(Boolean) as string[];
    return parts;
  });
  const agentMd = [
    "# Mimi Seed Agent",
    "",
    "Mimi Seed MCP가 이 프로젝트에 연결되어 있습니다.",
    "Google Play · App Store · Firebase · AdMob을 도구로 직접 제어합니다.",
    "",
    "## 세션 시작",
    "",
    "1. 출시/스토어/Firebase/AdMob 요청은 먼저 `mimi_seed_status`로 연결 상태를 확인",
    "2. 인증 누락이면 `mimi_seed_auth_start` 또는 아래 로컬 인증 명령을 안내",
    "3. Claude Code에서 도구 schema가 deferred 상태라면 필요한 도구를 `ToolSearch(query=\"select:<tool>[,<tool>...]\")`로 먼저 로드",
    "",
    "## 출시 요청 처리 순서",
    "",
    "1. 항상 `playstore_check_submission_risks` / `appstore_check_submission_risks` 로 블로커 확인",
    "2. 릴리즈 노트는 `docs/releases.json`을 SSOT로 확인/작성 → 사용자 확인 후 적용",
    "3. 스토어 **쓰기** 작업(submit, apply, reply, delete)은 반드시 사용자 명시 동의 후 실행",
    "4. 출시 완료 후 적용 결과와 실패 지점 요약",
    "",
    "## 인증 복구",
    "",
    "- Google/Firebase/AdMob/Play OAuth: `npx -y @yoonion/mimi-seed-mcp mimi-seed-auth`",
    "- App Store Connect: `npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth`",
    "- Play service account: `npx -y @yoonion/mimi-seed-mcp mimi-seed-playstore-auth`",
    "",
    "## 앱 정보",
    ...(appLines.length > 0 ? appLines : ["  (mimi-seed status 로 확인)"]),
    "",
    "## 슬래시 커맨드",
    "",
    "- `/mimi-seed:deploy` — 전체 출시 파이프라인",
    "- `/mimi-seed:health` — 연결 상태 빠른 확인",
    "- `/mimi-seed:review-inbox` — 미답변 리뷰 답변",
  ].join("\n");

  // Claude Code는 .claude 하위 문서를, Codex는 AGENTS.md를 프로젝트 컨텍스트로 읽는다.
  const claudeDir = path.join(cwd, ".claude");
  const claudeAgentPath = path.join(claudeDir, "mimi-seed.md");
  if (!fs.existsSync(claudeAgentPath)) {
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(claudeAgentPath, agentMd, { mode: 0o644 });
    log(kleur.dim(M().claudeAgent));
  }

  const codexAgentPath = path.join(cwd, "AGENTS.md");
  if (!fs.existsSync(codexAgentPath)) {
    fs.writeFileSync(codexAgentPath, agentMd, { mode: 0o644 });
    log(kleur.dim(M().codexAgent));
  }

  const manifest = await ensureReleaseManifest(cwd);
  log(kleur.dim(M().manifest(manifest.created)));

  log(kleur.bold(M().ready));
  log("");
  log(M().askLike);
  log(kleur.cyan(M().ask1));
  log(kleur.cyan(M().ask2));
  log(kleur.cyan(M().ask3));
  log("");
  log(M().dashboard(kleur.underline(DEFAULT_WEB_BASE + "/apps")));
  log("");
  printMcpSetup(cfg);

  if (local) {
    log("");
    log(kleur.bold(M().localTitle));
    log(kleur.dim(M().localIntro));
    log("");
    log(M().localStep1);
    await cmdAuth(["login"]);
    log("");
    log(M().localStep2);
    log(kleur.cyan("   claude mcp add mimi-seed-local -- npx -y @yoonion/mimi-seed-mcp"));
    log(kleur.dim(M().localCodexHint));
    log("");
    log(M().localStep3);
    log(kleur.cyan("   mimi-seed setup"));
    log(kleur.dim(M().localSetupHint));
  }
}

async function cmdStatus(): Promise<void> {
  const cfg = await getEffectiveConfig();
  if (!cfg) {
    log(kleur.yellow(M().notConnected));
    process.exit(1);
  }
  log(kleur.bold(M().statusTitle));
  log(M().statusToken(cfg.prefix, cfg.createdAt.slice(0, 10)));
  log(M().statusEndpoint(cfg.endpoint));
  log("");
  log(M().appList);
  const r = await mcpCall(cfg.endpoint, cfg.token, "list_apps", {});
  if (r.isError) {
    log(kleur.red(M().listFailed(r.text)));
    process.exit(1);
  }
  for (const line of r.text.split("\n")) log("  " + line);
}

async function cmdLogout(): Promise<void> {
  await deleteConfig();
  log(kleur.green(M().logoutDone));
  log(kleur.dim(M().logoutRevoke));
}

async function cmdMcp(args: string[]): Promise<void> {
  const target = args[0] ?? "help";
  const cfg = await getEffectiveConfig();
  if (!cfg) {
    log(kleur.yellow(M().notConnected));
    process.exit(1);
  }

  if (target === "codex") {
    if (args.includes("--write")) {
      const configPath = await writeCodexMcpConfig(cfg);
      log(kleur.green(M().codexWritten));
      log(kleur.dim(`  ${configPath}`));
      log(kleur.dim(M().codexWriteWarn));
      log("");
      log(M().codexVerify);
      return;
    }
    log(kleur.bold(M().codexTitle));
    log("");
    log(M().codexAuto);
    log(kleur.cyan("  mimi-seed mcp codex --write"));
    log("");
    log(M().codexManual);
    log(`[mcp_servers.mimi-seed-remote]
url = "${cfg.endpoint}"
bearer_token_env_var = "MIMI_SEED_TOKEN"
enabled = true`);
    return;
  }

  if (target === "claude") {
    log(kleur.bold(M().claudeTitle));
    log(kleur.cyan(`  ${claudeMcpAddCommand(cfg)}`));
    log(kleur.dim(M().claudeWarn));
    return;
  }

  printMcpSetup(cfg);
}

// auth 는 자체 상세 help(printAuthHelp)를 가지므로 여기서 제외 — main()에서 위임.
function printCommandHelp(cmd: string): boolean {
  const usage = (M().usage as Record<string, string | undefined>)[cmd];
  if (!usage) return false;
  log(usage);
  return true;
}

function printHelp(): void {
  log(M().help);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const restArgs = process.argv.slice(3);

  // 명령별 --help / -h. auth 는 cmdAuth 가 자체 상세 help 를 출력하므로 위임.
  if (cmd && cmd !== "auth" && (restArgs.includes("--help") || restArgs.includes("-h"))) {
    if (printCommandHelp(cmd)) return;
  }

  try {
    switch (cmd) {
      case "init":
        await cmdInit(restArgs);
        break;
      case "setup":
        await cmdSetup(restArgs);
        break;
      case "lang":
        await cmdLang(restArgs);
        break;
      case "status":
        await cmdStatus();
        break;
      case "doctor":
        await cmdDoctor();
        break;
      case "check":
        await cmdCheck(restArgs);
        break;
      case "notes":
        await cmdNotes(restArgs);
        break;
      case "review":
        await cmdReview(restArgs);
        break;
      case "auth":
        await cmdAuth(restArgs);
        break;
      case "firebase":
        await cmdFirebase(restArgs);
        break;
      case "admob":
        await cmdAdmob(restArgs);
        break;
      case "ga4":
        await cmdGa4(restArgs);
        break;
      case "deploy":
        await cmdDeploy(restArgs);
        break;
      case "mcp":
        await cmdMcp(restArgs);
        break;
      case "restart":
        await cmdRestart(restArgs);
        break;
      case "logout":
        await cmdLogout();
        break;
      case "--help":
      case "-h":
      case undefined:
        printHelp();
        break;
      default:
        log(kleur.red(t().common.unknownCommand(cmd)));
        printHelp();
        process.exit(1);
    }
  } catch (e) {
    log(kleur.red(t().common.error((e as Error).message)));
    if (process.env.DEBUG) log((e as Error).stack ?? "");
    process.exit(1);
  }
}

void main();
