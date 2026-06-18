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
import { cmdFirebase, cmdAdmob, cmdGa4 } from "./cloud.js";
import { cmdDeploy } from "./deploy.js";
import { cmdRestart } from "./mcp-restart.js";
import { printMcpSetup, writeCodexMcpConfig } from "./mcp-config.js";

const DEFAULT_WEB_BASE = process.env.MIMI_SEED_WEB_BASE ?? "https://mimi-seed.pryzm.gg";
const DEFAULT_MCP_ENDPOINT = `${DEFAULT_WEB_BASE}/api/mcp`;

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
    log(kleur.yellow("⚠ package.json / app.json / android / ios 를 찾지 못했습니다. 그래도 진행합니다."));
  }
  log("🔍 앱 감지 중...");
  const hints = await detectHints(cwd);
  if (hints.length === 0) {
    log(kleur.yellow("감지된 앱 없음. 웹에서 수동 등록 가능."));
  } else {
    for (const h of hints) {
      const tag = [h.packageName && `android:${h.packageName}`, h.bundleId && `ios:${h.bundleId}`]
        .filter(Boolean)
        .join("  ");
      log(`  • ${h.name ?? "(이름 미상)"}  ${kleur.dim(tag)}`);
    }
  }
  log("");

  // CI 모드: MIMI_SEED_TOKEN이 이미 있으면 핸드셰이크 생략
  if (process.env.MIMI_SEED_TOKEN) {
    const cfg = await getEffectiveConfig();
    if (cfg && hints.length > 0) {
      log(kleur.dim("CI 모드: MIMI_SEED_TOKEN 사용"));
      const payload = hints.map((h) => ({ name: h.name, packageName: h.packageName, bundleId: h.bundleId }));
      const result = await mcpCall(cfg.endpoint, cfg.token, "sync_apps", { hints: payload });
      if (result.isError) {
        log(kleur.red("등록 실패: " + result.text));
      } else {
        for (const line of result.text.split("\n")) log("  " + line);
      }
    }
    log(kleur.bold("✓ 완료 (CI 모드)"));
    return;
  }

  log("🔐 브라우저에서 로그인 대기...");
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
    log(kleur.red("연결 실패: " + (e as Error).message));
    process.exit(1);
  }
  log(kleur.green("✓ 토큰 수신"));

  const cfg: MimiSeedConfig = {
    token: handshake.token,
    prefix: handshake.prefix,
    endpoint: DEFAULT_MCP_ENDPOINT,
    webBase: DEFAULT_WEB_BASE,
    createdAt: new Date().toISOString(),
  };
  await writeConfig(cfg);
  log(kleur.dim(`  저장됨: ${CONFIG_LOCATION}`));
  log("");

  if (hints.length > 0) {
    log("🔄 앱 등록 중...");
    const payload = hints.map((h) => ({ name: h.name, packageName: h.packageName, bundleId: h.bundleId }));
    const result = await mcpCall(cfg.endpoint, cfg.token, "sync_apps", { hints: payload });
    if (result.isError) {
      log(kleur.red("등록 실패: " + result.text));
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
    "## 출시 요청 처리 순서",
    "",
    "1. 항상 `playstore_check_submission_risks` / `appstore_check_submission_risks` 로 블로커 먼저 확인",
    "2. 릴리즈 노트: `generate_release_notes_from_commits` → 사용자 확인 후 적용",
    "3. 스토어 **쓰기** 작업(submit, apply, reply)은 반드시 사용자 명시 동의 후 실행",
    "4. 완료 후 결과 요약 제공",
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
    log(kleur.dim(`  Claude 에이전트 설정: .claude/mimi-seed.md`));
  }

  const codexAgentPath = path.join(cwd, "AGENTS.md");
  if (!fs.existsSync(codexAgentPath)) {
    fs.writeFileSync(codexAgentPath, agentMd, { mode: 0o644 });
    log(kleur.dim(`  Codex 에이전트 설정: AGENTS.md`));
  }

  log(kleur.bold("✓ 준비 완료."));
  log("");
  log("Claude Code 또는 Codex에서 이렇게 물어보세요:");
  log(kleur.cyan('  "내 앱 출시 준비됐어?"'));
  log(kleur.cyan('  "릴리즈 노트 써줘"'));
  log(kleur.cyan('  "등록된 앱 목록 보여줘"'));
  log("");
  log(`대시보드: ${kleur.underline(DEFAULT_WEB_BASE + "/apps")}`);
  log("");
  printMcpSetup(cfg);

  if (local) {
    log("");
    log(kleur.bold("── 로컬 MCP 추가 설정 (--local) ──"));
    log(kleur.dim("원격 MCP(16 tool, PAT)는 위에서 끝. 로컬 MCP는 Google OAuth로 110+ tool을 직접 실행합니다."));
    log("");
    log("1) Google 로그인 (Firebase / AdMob / Play / Ads):");
    await cmdAuth(["login"]);
    log("");
    log("2) 로컬 MCP 서버 등록 (원격 'mimi-seed' 와 별개):");
    log(kleur.cyan("   claude mcp add mimi-seed-local -- npx -y @yoonion/mimi-seed-mcp"));
    log(kleur.dim('   Codex: ~/.codex/config.toml 에 [mcp_servers.mimi-seed-local] command="npx", args=["-y","@yoonion/mimi-seed-mcp"]'));
  }
}

async function cmdStatus(): Promise<void> {
  const cfg = await getEffectiveConfig();
  if (!cfg) {
    log(kleur.yellow("연결된 Mimi Seed 계정이 없습니다. `mimi-seed init` 실행."));
    process.exit(1);
  }
  log(kleur.bold("Mimi Seed 연결 상태"));
  log(`  토큰: ${cfg.prefix}…  (${cfg.createdAt.slice(0, 10)})`);
  log(`  엔드포인트: ${cfg.endpoint}`);
  log("");
  log("📋 앱 목록:");
  const r = await mcpCall(cfg.endpoint, cfg.token, "list_apps", {});
  if (r.isError) {
    log(kleur.red("조회 실패: " + r.text));
    process.exit(1);
  }
  for (const line of r.text.split("\n")) log("  " + line);
}

async function cmdLogout(): Promise<void> {
  await deleteConfig();
  log(kleur.green("✓ 로컬 설정 삭제 완료."));
  log(kleur.dim("웹에서 토큰 해지: /workspace/api-tokens"));
}

async function cmdMcp(args: string[]): Promise<void> {
  const target = args[0] ?? "help";
  const cfg = await getEffectiveConfig();
  if (!cfg) {
    log(kleur.yellow("연결된 Mimi Seed 계정이 없습니다. `mimi-seed init` 실행."));
    process.exit(1);
  }

  if (target === "codex") {
    if (args.includes("--write")) {
      const configPath = await writeCodexMcpConfig(cfg);
      log(kleur.green("✓ Codex MCP 설정 완료"));
      log(kleur.dim(`  ${configPath}`));
      log(kleur.dim("  ⚠ config.toml에 실제 토큰이 평문으로 저장됩니다 (파일 권한 확인 권장)."));
      log("");
      log("Codex를 새로 열고 `/mcp` 또는 `codex mcp list`로 확인하세요.");
      return;
    }
    log(kleur.bold("Codex MCP 등록"));
    log("");
    log("자동 등록:");
    log(kleur.cyan("  mimi-seed mcp codex --write"));
    log("");
    log("수동 등록 예시 (~/.codex/config.toml):");
    log(`[mcp_servers.mimi-seed]
url = "${cfg.endpoint}"
enabled = true
http_headers = { Authorization = "Bearer ${cfg.prefix}..." }`);
    return;
  }

  if (target === "claude") {
    log(kleur.bold("Claude Code MCP 등록"));
    log(kleur.cyan(`  claude mcp add --transport http mimi-seed ${cfg.endpoint} \\`));
    log(kleur.cyan(`    --header "Authorization: Bearer ${cfg.prefix}..."`));
    return;
  }

  printMcpSetup(cfg);
}

// 명령별 상세 사용법 (SSOT). `mimi-seed <command> --help` 와 overview 가 공유.
const CMD_USAGE: Record<string, string> = {
  init: `${kleur.bold("mimi-seed init")} — 현재 프로젝트를 Mimi Seed에 연결

앱 자동 감지(Expo/Gradle/Info.plist/pbxproj) → 브라우저 PAT 발급(원격 MCP) → 앱 등록
+ .claude/mimi-seed.md, AGENTS.md 생성.

옵션:
  --local   추가로 Google OAuth 로그인 + 로컬 110+ tool MCP 등록 안내`,
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
};

// auth 는 자체 상세 help(printAuthHelp)를 가지므로 여기서 제외 — main()에서 위임.
function printCommandHelp(cmd: string): boolean {
  const usage = CMD_USAGE[cmd];
  if (!usage) return false;
  log(usage);
  return true;
}

function printHelp(): void {
  log(`${kleur.bold("mimi-seed")} — Claude Code/Codex에서 앱 출시 운영

${kleur.bold("명령어:")}
  ${kleur.cyan("mimi-seed init")}        현재 프로젝트를 Mimi Seed에 연결
  ${kleur.cyan("mimi-seed status")}      연결 상태 + 등록 앱 목록
  ${kleur.cyan("mimi-seed auth")}        로컬 인증 (Google OAuth / App Store / Play / BigQuery)
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
`);
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
        log(kleur.red(`알 수 없는 명령: ${cmd}`));
        printHelp();
        process.exit(1);
    }
  } catch (e) {
    log(kleur.red(`오류: ${(e as Error).message}`));
    if (process.env.DEBUG) log((e as Error).stack ?? "");
    process.exit(1);
  }
}

void main();
