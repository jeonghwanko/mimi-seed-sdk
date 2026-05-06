// `mimi-seed auth ...` 서브명령
// 실제 OAuth 로직은 @yoonion/mimi-seed-mcp 의 mimi-seed-auth CLI에 있고,
// 이 래퍼는 npx 로 호출해 stdio 그대로 패스스루한다.
// 사용자가 mimi-seed 한 패키지만 알고 있어도 인증 사이클 전체를 돌릴 수 있게 해준다.

import { spawn } from "node:child_process";
import kleur from "kleur";

const MCP_PKG = "@yoonion/mimi-seed-mcp";

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

function printAuthHelp(): void {
  log(`${kleur.bold("mimi-seed auth")} — Google OAuth 인증 (Firebase / AdMob / Play Store)

${kleur.bold("서브명령:")}
  ${kleur.cyan("mimi-seed auth login")}     브라우저로 로그인 (이미 있으면 자동 refresh 시도)
  ${kleur.cyan("mimi-seed auth status")}    현재 토큰 상태
  ${kleur.cyan("mimi-seed auth refresh")}   refresh_token으로 갱신만 시도 (브라우저 X)
  ${kleur.cyan("mimi-seed auth logout")}    토큰 삭제

${kleur.bold("login 옵션:")}
  --no-browser     URL 자동 오픈 안 함 (직접 복붙)
  --timeout <초>   콜백 대기 시간 (기본 600)
  --force          기존 토큰 무시하고 강제 재로그인

${kleur.dim(`내부적으로 ${MCP_PKG} 의 mimi-seed-auth CLI를 호출합니다.`)}`);
}

async function runMcpAuth(extraArgs: string[]): Promise<number> {
  return new Promise((resolve) => {
    // npx 로 mimi-seed-auth 실행. stdio inherit 로 진행 출력 그대로 보임.
    // Windows / POSIX 양쪽 호환을 위해 shell:true.
    const child = spawn("npx", ["-y", `${MCP_PKG}`, "mimi-seed-auth", ...extraArgs], {
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

export async function cmdAuth(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === "--help" || sub === "-h" || sub === "help") {
    printAuthHelp();
    return;
  }

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

  const code = await runMcpAuth(mcpArgs);
  if (code !== 0) process.exit(code);
}
