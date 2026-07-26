// `mimi-seed firebase|admob|ga4 ...` 서브명령 — Firebase/AdMob/GA4 attach 의 front door.
// 실제 로직은 @yoonion/mimi-seed-mcp 의 mimi-seed-firebase / -admob / -ga4 sub-CLI 에 있고,
// 이 래퍼는 stdio 그대로 패스스루한다.
// 사용자가 mimi-seed 한 패키지만 알아도 클라우드 리소스 프로비저닝 사이클을 돌릴 수 있게 한다.
//
// 러너는 mcp-bin.ts 하나뿐이다. 예전엔 이 파일에 사본이 있었는데, 그 사본에는
// (1) PATH 우선 탐색이 없어 `npm link` 개발 클론에서 레지스트리 배포판이 돌았고
// (2) MIMI_SEED_LANG 전달이 없어 부모/자식 프롬프트 언어가 갈렸다 — 둘 다 mcp-bin.ts 가
// 이미 고쳐둔 버그였다. 사본은 고친 버그를 되살린다.

import { runMcpBin } from "./mcp-bin.js";

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
