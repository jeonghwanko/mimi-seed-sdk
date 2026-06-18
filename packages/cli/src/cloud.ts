// `mimi-seed firebase|admob|ga4 ...` 서브명령 — Firebase/AdMob/GA4 attach 의 front door.
// 실제 로직은 @yoonion/mimi-seed-mcp 의 mimi-seed-firebase / -admob / -ga4 sub-CLI 에 있고,
// 이 래퍼는 npx 로 호출해 stdio 그대로 패스스루한다 (auth.ts:runMcpBin 패턴과 동일).
// 사용자가 mimi-seed 한 패키지만 알아도 클라우드 리소스 프로비저닝 사이클을 돌릴 수 있게 한다.

import { spawn } from "node:child_process";

const MCP_PKG = "@yoonion/mimi-seed-mcp";

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

function exitWith(code: number): void {
  if (code !== 0) process.exit(code);
}

export async function cmdFirebase(args: string[]): Promise<void> {
  exitWith(await runMcpBin("mimi-seed-firebase", args));
}

export async function cmdAdmob(args: string[]): Promise<void> {
  exitWith(await runMcpBin("mimi-seed-admob", args));
}

export async function cmdGa4(args: string[]): Promise<void> {
  exitWith(await runMcpBin("mimi-seed-ga4", args));
}
