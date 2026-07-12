// @yoonion/mimi-seed-mcp 의 setup 계열 bin 을 npx 로 실행하는 공용 러너.
//
// 왜 CLI 가 직접 자격증명 JSON 을 쓰지 않고 셸아웃하는가:
// 자격증명 writer 와 그 검증 로직(토큰으로 실제 API 를 호출해 보고 실패하면 저장을 거부)은
// mcp-server 쪽에만 있다. CLI 는 mcp-server 에 의존하지 않으므로(deps 3개뿐) 이를 복제하면
// 두 벌의 writer 가 갈라진다 — 그게 정확히 Jenkins 설정이 config.json/jenkins.json 두 곳으로
// 갈라졌던 원인이다. 규칙: **자격증명 하나당 writer 는 정확히 하나**.

import { spawn, spawnSync } from "node:child_process";
import { t } from "./i18n.js";
import { resolveLang } from "./settings.js";

export const MCP_PKG = "@yoonion/mimi-seed-mcp";

/** setup 계열 bin 이름 — mcp-server package.json 의 "bin" 과 일치해야 한다 (테스트로 강제). */
export type McpBin =
  | "mimi-seed-auth"
  | "mimi-seed-appstore-auth"
  | "mimi-seed-playstore-auth"
  | "mimi-seed-bigquery-auth"
  | "mimi-seed-jenkins-auth"
  | "mimi-seed-googleads-auth"
  | "mimi-seed-social-auth";

/**
 * bin 이 PATH 에 이미 있는가 (전역 설치 또는 `npm link` 한 개발 클론).
 *
 * 있으면 npx 대신 그걸 직접 쓴다. `npm link` 로 만든 개발 클론에서 npx 를 고집하면
 * **레지스트리의 배포판**이 실행돼서, 작업 트리를 고쳐도 반영되지 않는다 —
 * "내 코드가 안 도는데?" 로 이어지는 함정이다. (docs/from-source.md)
 */
function resolveOnPath(bin: string): boolean {
  if (process.env.MIMI_SEED_FORCE_NPX) return false;
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, [bin], { stdio: "ignore", shell: true });
  return r.status === 0;
}

/** setup bin 실행. stdio inherit 이라 대화형 프롬프트가 그대로 사용자에게 보인다. */
export async function runMcpBin(bin: McpBin, extraArgs: string[] = []): Promise<number> {
  const local = resolveOnPath(bin);
  const cmd = local ? bin : "npx";
  // MIMI_SEED_FORCE_NPX 는 "배포판을 써라" 는 뜻이다. 그런데 전역 `npm link` 가 걸려 있으면
  // 그냥 `npx -y @yoonion/mimi-seed-mcp` 도 PATH 의 **링크된** bin 을 먼저 집어서 결국 체크아웃
  // 코드를 실행한다 (실측으로 확인). `@latest` 를 붙여야 레지스트리의 진짜 배포판을 받아온다.
  const pkg = process.env.MIMI_SEED_FORCE_NPX ? `${MCP_PKG}@latest` : MCP_PKG;
  const args = local ? extraArgs : ["-y", pkg, bin, ...extraArgs];

  return new Promise((resolve) => {
    // Windows / POSIX 양쪽 호환을 위해 shell:true (npm link 는 Windows 에서 .cmd 셰임을 깐다).
    // 언어를 환경변수로 물려준다 — 안 그러면 마법사는 영어인데 자식 프롬프트만 한국어로 나온다.
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, MIMI_SEED_LANG: resolveLang() },
    });
    child.on("error", (e) => {
      process.stderr.write(t().auth.npxFailed(cmd, e.message));
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 0));
  });
}
