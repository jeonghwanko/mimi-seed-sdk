// `mimi-seed auth ...` 서브명령 — 로컬 MCP가 쓰는 4개 자격증명의 통합 front door.
// 실제 로직은 @yoonion/mimi-seed-mcp 의 mimi-seed-*-auth CLI들에 있고,
// 이 래퍼는 npx 로 호출해 stdio 그대로 패스스루한다.
// 사용자가 mimi-seed 한 패키지만 알고 있어도 모든 인증 사이클을 돌릴 수 있게 해준다.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import kleur from "kleur";

const MCP_PKG = "@yoonion/mimi-seed-mcp";
const MIMI_DIR = path.join(os.homedir(), ".mimi-seed");

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

function printAuthHelp(): void {
  log(`${kleur.bold("mimi-seed auth")} — 로컬 자격증명 인증/관리

${kleur.bold("Google OAuth (Firebase / AdMob / Play):")}
  ${kleur.cyan("mimi-seed auth login")}      브라우저로 로그인 (이미 있으면 자동 refresh 시도)
  ${kleur.cyan("mimi-seed auth status")}     현재 OAuth 토큰 상태
  ${kleur.cyan("mimi-seed auth refresh")}    refresh_token으로 갱신만 시도 (브라우저 X)
  ${kleur.cyan("mimi-seed auth logout")}     OAuth 토큰 삭제

${kleur.bold("플랫폼별 자격증명:")}
  ${kleur.cyan("mimi-seed auth appstore")}   App Store Connect API 키 (appstore.json)
  ${kleur.cyan("mimi-seed auth playstore")}  Play 서비스 계정 JSON 등록
  ${kleur.cyan("mimi-seed auth bigquery")}   BigQuery 서비스 계정 (Crashlytics export 등)

${kleur.bold("전체 상태:")}
  ${kleur.cyan("mimi-seed auth status --all")}  4개 자격증명 보유 여부 한눈에

${kleur.bold("login 옵션:")}
  --no-browser     URL 자동 오픈 안 함 (직접 복붙)
  --timeout <초>   콜백 대기 시간 (기본 600)
  --force          기존 토큰 무시하고 강제 재로그인

${kleur.dim(`내부적으로 ${MCP_PKG} 의 mimi-seed-*-auth CLI를 호출합니다.`)}`);
}

async function runMcpBin(bin: string, extraArgs: string[]): Promise<number> {
  return new Promise((resolve) => {
    // npx 로 해당 bin 실행. stdio inherit 로 진행 출력 그대로 보임.
    // Windows / POSIX 양쪽 호환을 위해 shell:true.
    const child = spawn("npx", ["-y", `${MCP_PKG}`, bin, ...extraArgs], {
      stdio: "inherit",
      shell: true,
    });
    child.on("error", (e) => {
      process.stderr.write(`\n  ❌ npx 실행 실패: ${e.message}\n`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

function fileExists(name: string): boolean {
  return fs.existsSync(path.join(MIMI_DIR, name));
}

function anyFileStarting(prefix: string): boolean {
  try {
    return fs.readdirSync(MIMI_DIR).some((f) => f.startsWith(prefix));
  } catch {
    return false;
  }
}

function printAllCredStatus(): void {
  log(kleur.bold("로컬 자격증명 상태  ") + kleur.dim("(~/.mimi-seed)"));
  const rows: Array<[string, boolean, string]> = [
    ["Google OAuth (Firebase/AdMob/Play)", fileExists("tokens.json"), "mimi-seed auth login"],
    ["App Store Connect", fileExists("appstore.json"), "mimi-seed auth appstore"],
    ["Play 서비스 계정", anyFileStarting("play-service-account"), "mimi-seed auth playstore"],
    ["BigQuery 서비스 계정", anyFileStarting("bigquery"), "mimi-seed auth bigquery"],
  ];
  for (const [label, ok, cmd] of rows) {
    const mark = ok ? kleur.green("✓") : kleur.red("✗");
    const hint = ok ? "" : kleur.dim(`  → ${cmd}`);
    log(`  ${mark} ${label}${hint}`);
  }
}

export async function cmdAuth(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === "--help" || sub === "-h" || sub === "help") {
    printAuthHelp();
    return;
  }

  // status --all: 4개 자격증명 파일 존재 여부 요약 (네트워크 호출 없음)
  if (sub === "status" && rest.includes("--all")) {
    printAllCredStatus();
    return;
  }

  // 플랫폼별 자격증명 셋업 CLI 위임 (각자 별도 bin)
  if (sub === "appstore") return void exitWith(await runMcpBin("mimi-seed-appstore-auth", rest));
  if (sub === "playstore") return void exitWith(await runMcpBin("mimi-seed-playstore-auth", rest));
  if (sub === "bigquery") return void exitWith(await runMcpBin("mimi-seed-bigquery-auth", rest));

  // 기본 Google OAuth (mimi-seed-auth)
  let mcpArgs: string[];
  switch (sub) {
    case undefined:
    case "login":
      mcpArgs = rest;
      break;
    case "status":
      mcpArgs = ["--status", ...rest];
      break;
    case "refresh":
      mcpArgs = ["--refresh", ...rest];
      break;
    case "logout":
      mcpArgs = ["--logout", ...rest];
      break;
    default:
      log(kleur.red(`알 수 없는 auth 서브명령: ${sub}`));
      printAuthHelp();
      process.exit(1);
  }

  exitWith(await runMcpBin("mimi-seed-auth", mcpArgs));
}

function exitWith(code: number): void {
  if (code !== 0) process.exit(code);
}
