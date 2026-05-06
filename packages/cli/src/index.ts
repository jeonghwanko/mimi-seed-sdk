// Mimi Seed CLI

import os from "node:os";
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
import { cmdDeploy } from "./deploy.js";
import { cmdRestart } from "./mcp-restart.js";

const DEFAULT_WEB_BASE = process.env.MIMI_SEED_WEB_BASE ?? "https://mimi-seed.pryzm.gg";
const DEFAULT_MCP_ENDPOINT = `${DEFAULT_WEB_BASE}/api/mcp`;

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

async function cmdInit(): Promise<void> {
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

  log(kleur.bold("✓ 준비 완료."));
  log("");
  log("Claude Code에서 이렇게 물어보세요:");
  log(kleur.cyan('  "내 앱 출시 준비됐어?"'));
  log(kleur.cyan('  "릴리즈 노트 써줘"'));
  log(kleur.cyan('  "등록된 앱 목록 보여줘"'));
  log("");
  log(`대시보드: ${kleur.underline(DEFAULT_WEB_BASE + "/apps")}`);
  log("");
  log(
    kleur.dim(
      "Claude Code MCP 등록:\n" +
        `  claude mcp add --transport http mimi-seed ${DEFAULT_MCP_ENDPOINT} \\\n` +
        `    --header "Authorization: Bearer ${cfg.prefix}..."`,
    ),
  );
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

function printHelp(): void {
  log(`${kleur.bold("mimi-seed")} — Claude Code에서 앱 출시 운영

${kleur.bold("명령어:")}
  ${kleur.cyan("mimi-seed init")}        현재 프로젝트를 Mimi Seed에 연결
  ${kleur.cyan("mimi-seed status")}      연결 상태 + 등록 앱 목록
  ${kleur.cyan("mimi-seed auth")}        Google OAuth 인증 (Firebase/AdMob/Play). 'mimi-seed auth --help'
  ${kleur.cyan("mimi-seed doctor")}      환경 진단 (토큰·Git·프로젝트·CI 체크)
  ${kleur.cyan("mimi-seed check")}       출시 전 Readiness 점검
  ${kleur.cyan("mimi-seed notes")}       릴리즈 노트 생성 (git log → AI → 마켓 적용)
  ${kleur.cyan("mimi-seed review")}      리뷰 답변 AI 초안 생성 및 Play Store 게시
  ${kleur.cyan("mimi-seed deploy")}      앱 자동 배포 (Jenkins → Play Store/App Store)
  ${kleur.cyan("mimi-seed restart")}     MCP 서버 프로세스 재시작 (기본: mimi-seed)
  ${kleur.cyan("mimi-seed logout")}      로컬 설정 삭제

${kleur.bold("mimi-seed notes 옵션:")}
  --from <ref>        시작 커밋/태그 (기본: 최신 태그)
  --to <ref>          끝 커밋 (기본: HEAD)
  --locale ko,en-US   대상 로케일 (쉼표 구분)
  --apply             생성 후 스토어에 바로 적용
  --no-interactive    CI 모드 (프롬프트 없음)
  --limit <n>         최대 커밋 수 (기본: 30)

${kleur.bold("mimi-seed check 옵션:")}
  --app <id>          앱 ID 지정
  --fail-on-blocker   블로커 있으면 exit 1 (CI용)

${kleur.bold("mimi-seed review 옵션:")}
  --text <내용>       리뷰 원문 (미입력 시 대화형 프롬프트)
  --rating <1-5>      별점
  --tone <tone>       friendly / professional / empathetic / brief (기본: friendly)
  --language <코드>   답변 언어 (기본: ko)
  --app-name <이름>   앱 이름 (맥락용)
  --apply             답변을 Play Store에 게시
  --review-id <id>    리뷰 ID (--apply 시 필요)
  --package-name <p>  패키지명 (--apply 시 필요)
  --no-interactive    CI 모드

${kleur.bold("mimi-seed deploy 옵션:")}
  --platform android|ios  배포 플랫폼 (기본: android)
  --app <id>              앱 ID 지정
  --version-code <n>      빌드 번호 직접 지정 (--skip-build 와 함께)
  --from <ref>            커밋 범위 시작 (릴리즈 노트용)
  --to <ref>              커밋 범위 끝 (기본: HEAD)
  --language <코드>       릴리즈 노트 언어 (기본: ko-KR)
  --dry-run               실제 배포 없이 파이프라인 테스트
  --skip-build            Jenkins 빌드 건너뜀 (--version-code 필수)
  setup-jenkins           Jenkins 설정 대화형 등록

${kleur.bold("환경변수:")}
  MIMI_SEED_TOKEN     PAT 토큰 (CI/CD 무인증 모드)
  MIMI_SEED_WEB_BASE  서버 주소 (기본: https://mimi-seed.pryzm.gg)
  ANTHROPIC_API_KEY   AI 노트 생성 활성화 (선택)
`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const restArgs = process.argv.slice(3);
  try {
    switch (cmd) {
      case "init":
        await cmdInit();
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
      case "deploy":
        await cmdDeploy(restArgs);
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
