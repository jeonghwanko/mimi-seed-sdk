// `mimi-seed <command> --help` 와 맨 `mimi-seed` 가 출력하는 사용법 — 명령별 플래그의 SSOT.
//
// 명령을 추가하면 여기 두 곳(`usage.<command>`, `help` 의 한 줄 요약)과 index.ts 의 `switch`
// case 를 함께 고친다 (docs/domain/recipes.md §3). auth 는 auth.ts 가 자체 상세 help 를 가진다.
// kleur 가 섞여 있지만 언어별로 모듈 로드 시점에 한 번 만들어 두면 되므로 그대로 둔다.

import kleur from "kleur";
import { catalog } from "./i18n.js";

const M = catalog(
  {
    // 명령별 상세 사용법 (SSOT). `mimi-seed <command> --help` 와 overview 가 공유.
    usage: {
      telemetry: "mimi-seed telemetry on|off|status — 선택적 사용량 측정. 기본 꺼짐. 임의 설치 ID, 프로젝트 해시, 버전, OS, 결과 코드와 실행시간을 전송합니다. 개인정보 안내: https://mimi-seed.pryzm.gg/privacy/sdk-usage . MIMI_SEED_TELEMETRY=0은 항상 전송을 끕니다.",
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
      doctor: `${kleur.bold("mimi-seed doctor")} — 환경 진단 (토큰·Node·Git·프로젝트·CI)

기본은 진단만 하고 exit 0. Mimi Seed 클라우드 토큰은 원격 기능
(MIMI_SEED_TOKEN · MIMI_SEED_WEB_BASE · .mimi-seed-link.json)을 쓸 때만, App Store Connect 는
프로젝트에 iOS 앱이 있을 때만 ✗ 로 본다.

옵션:
  --strict  ✗ 항목이 하나라도 있으면 exit 1 (⚠ 는 실패가 아님) — CI 게이트용
  --json    사람용 출력 대신 진단 결과를 JSON으로 출력 (ok 필드 포함)`,
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
  --local             로그인 없이 현재 저장소만 검사
  --path <dir>        로컬 검사 대상 경로 (기본: 현재 폴더)
  --json              로컬 검사 결과를 JSON으로 출력
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
  --app <id>                   배포할 원격 앱 ID (실제 실행 필수)
  --version-code <n>           실제 스토어 빌드 번호 (CI 실행 번호 아님)
  --from <ref>                 커밋 범위 시작 (릴리즈 노트용)
  --to <ref>                   커밋 범위 끝 (기본: HEAD)
  --language <코드>            릴리즈 노트 언어 (기본: ko-KR)
  --dry-run                    로컬 계획만 출력 (네트워크·빌드·쓰기 없음)
  --yes, -y                    CI 실행·스토어 배포 명시적 승인 (실행 필수)
  --skip-build                 CI 빌드 건너뜀 (--version-code 필수)
  --prepare-only              빌드·버전 확인 후 웹 기록을 준비 상태로 두고 제출 중단
  --resume <runId>            준비된 배포를 CI 빌드 없이 이어서 제출
  --ci jenkins|github|gitlab   CI 강제 선택 (기본: auto)
  --workflow <file>            GitHub workflow 파일 (예: deploy.yml)
  --ref <branch|tag>           CI 소스 (기본: main, Jenkins는 브랜치만)
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
  ${kleur.cyan("mimi-seed telemetry")}   선택적 사용량 측정 설정
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
    usage: {
      telemetry: "mimi-seed telemetry on|off|status — optional usage measurement, off by default. Sends a random installation ID, project hash, version, OS, result codes and duration. Privacy: https://mimi-seed.pryzm.gg/privacy/sdk-usage . MIMI_SEED_TELEMETRY=0 always disables transmission.",
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
      doctor: `${kleur.bold("mimi-seed doctor")} — environment check (token · Node · Git · project · CI)

By default it only reports and exits 0. The Mimi Seed cloud token is only a ✗ when remote features
are configured (MIMI_SEED_TOKEN · MIMI_SEED_WEB_BASE · .mimi-seed-link.json), and App Store Connect
only when the project has an iOS app.

Options:
  --strict  exit 1 if any ✗ check fails (⚠ is not a failure) — for CI gating
  --json    print the diagnosis as JSON instead of the human-readable report (includes ok)`,
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
  --local             inspect the current repository without signing in
  --path <dir>        local project path (default: current directory)
  --json              print the local report as JSON
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
  --app <id>                   remote app ID (required for execution)
  --version-code <n>           actual store build number (not a CI run ID)
  --from <ref>                 commit range start (for release notes)
  --to <ref>                   commit range end (default: HEAD)
  --language <code>            release notes language (default: ko-KR)
  --dry-run                    print a local plan (no network, builds or writes)
  --yes, -y                    explicitly approve CI and store release (required)
  --skip-build                 skip the CI build (--version-code required)
  --prepare-only              stop after build/version verification with a ready web record
  --resume <runId>            submit a ready deployment without rebuilding
  --ci jenkins|github|gitlab   force the CI provider (default: auto)
  --workflow <file>            GitHub workflow file (e.g. deploy.yml)
  --ref <branch|tag>           CI source (default: main; Jenkins: branches only)
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
  ${kleur.cyan("mimi-seed telemetry")}   optional usage measurement settings
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

/** `mimi-seed <cmd> --help` — 알려진 명령이면 사용법을 찍고 true. */
export function printCommandHelp(cmd: string): boolean {
  const usage = (M().usage as Record<string, string | undefined>)[cmd];
  if (!usage) return false;
  process.stdout.write(usage + "\n");
  return true;
}

export function printHelp(): void {
  process.stdout.write(M().help + "\n");
}
