// @yoonion/mimi-seed-mcp 의 setup 계열 bin 을 npx 로 실행하는 공용 러너.
//
// 왜 CLI 가 직접 자격증명 JSON 을 쓰지 않고 셸아웃하는가:
// 자격증명 writer 와 그 검증 로직(토큰으로 실제 API 를 호출해 보고 실패하면 저장을 거부)은
// mcp-server 쪽에만 있다. CLI 는 mcp-server 에 의존하지 않으므로(deps 3개뿐) 이를 복제하면
// 두 벌의 writer 가 갈라진다 — 그게 정확히 Jenkins 설정이 config.json/jenkins.json 두 곳으로
// 갈라졌던 원인이다. 규칙: **자격증명 하나당 writer 는 정확히 하나**.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { t } from "./i18n.js";
import { resolveLang } from "./settings.js";

export const MCP_PKG = "@yoonion/mimi-seed-mcp";

/**
 * CLI 가 셸아웃하는 mcp-server bin 전체 — mcp-server package.json 의 "bin" 과 일치해야 한다
 * (`credentials.test.ts` 가 이 목록 전체를 강제한다).
 *
 * setup 계열뿐 아니라 클라우드 sub-CLI(firebase/admob/ga4)도 여기 있어야 한다. 예전엔
 * 후자가 cloud.ts 의 **별도 사본** runMcpBin 을 썼는데, 그 사본에는 PATH 우선 탐색도
 * MIMI_SEED_LANG 전달도 없어서 이 파일이 고쳤던 버그 두 개가 그 경로에서만 되살아나 있었다.
 */
export const MCP_BINS = [
  "mimi-seed-auth",
  "mimi-seed-appstore-auth",
  "mimi-seed-playstore-auth",
  "mimi-seed-bigquery-auth",
  "mimi-seed-jenkins-auth",
  "mimi-seed-googleads-auth",
  "mimi-seed-social-auth",
  "mimi-seed-tiktok-business-auth",
  "mimi-seed-firebase",
  "mimi-seed-admob",
  "mimi-seed-ga4",
  "mimi-seed-release-doctor",
] as const;

export type McpBin = (typeof MCP_BINS)[number];

/**
 * bin 이 PATH 에 이미 있는가 (전역 설치 또는 `npm link` 한 개발 클론).
 *
 * 있으면 npx 대신 그걸 직접 쓴다. `npm link` 로 만든 개발 클론에서 npx 를 고집하면
 * **레지스트리의 배포판**이 실행돼서, 작업 트리를 고쳐도 반영되지 않는다 —
 * "내 코드가 안 도는데?" 로 이어지는 함정이다. (docs/from-source.md)
 */
function resolveOnPath(bin: string, honorForceNpx = true): string | null {
  if (honorForceNpx && process.env.MIMI_SEED_FORCE_NPX) return null;
  if (process.platform === 'win32') {
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path');
    const directories = (pathKey ? process.env[pathKey] ?? '' : '').split(path.delimiter).filter(Boolean);
    const names = bin.toLowerCase().endsWith('.cmd') ? [bin] : [`${bin}.cmd`, bin];
    for (const directory of directories) {
      for (const name of names) {
        const candidate = path.join(directory.replace(/^"|"$/g, ''), name);
        if (existsSync(candidate)) return candidate;
      }
    }
    return null;
  }
  const probe = "which";
  const result = spawnSync(probe, [bin], { encoding: "utf8", shell: false });
  if (result.status !== 0) return null;
  const candidates = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return candidates[0] ?? null;
}

/** npm cmd-shim의 실제 JS 진입점을 찾아 셸 없이 node로 실행한다. */
export function resolveWindowsShimTarget(shimPath: string, source: string): string | null {
  const matches = [...source.matchAll(/["']([^"']+\.js)["']\s+%\*/gi)];
  const raw = matches.at(-1)?.[1];
  if (!raw) return null;
  return path.normalize(raw.replace(/%~?dp0%?/gi, `${path.dirname(shimPath)}${path.sep}`));
}

function npxCliPath(shimPath: string | null): string | null {
  const candidates = [
    shimPath ? path.join(path.dirname(shimPath), 'node_modules', 'npm', 'bin', 'npx-cli.js') : '',
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    process.env.npm_execpath ? path.join(path.dirname(process.env.npm_execpath), 'npx-cli.js') : '',
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

function windowsNodeTarget(command: string, shimPath: string | null): string | null {
  if (command === 'npx') return npxCliPath(shimPath);
  if (!shimPath) return null;
  try {
    const target = resolveWindowsShimTarget(shimPath, readFileSync(shimPath, 'utf8'));
    return target && existsSync(target) ? target : null;
  } catch {
    return null;
  }
}

/** setup bin 실행. stdio inherit 이라 대화형 프롬프트가 그대로 사용자에게 보인다. */
export async function runMcpBin(bin: McpBin, extraArgs: string[] = []): Promise<number> {
  const localPath = resolveOnPath(bin);
  const cmd = localPath ? bin : "npx";
  // MIMI_SEED_FORCE_NPX 는 "배포판을 써라" 는 뜻이다. 그런데 전역 `npm link` 가 걸려 있으면
  // 그냥 `npx -y @yoonion/mimi-seed-mcp` 도 PATH 의 **링크된** bin 을 먼저 집어서 결국 체크아웃
  // 코드를 실행한다 (실측으로 확인). `@latest` 를 붙여야 레지스트리의 진짜 배포판을 받아온다.
  const pkg = process.env.MIMI_SEED_FORCE_NPX ? `${MCP_PKG}@latest` : MCP_PKG;
  const args = localPath ? extraArgs : ["-y", pkg, bin, ...extraArgs];

  return new Promise((resolve) => {
    // Windows에서는 .cmd shim이 가리키는 JS를 node로 직접 실행한다. shell:true로 사용자 입력(--path 등)을 넘기면
    // 공백뿐 아니라 &, | 같은 문자가 명령으로 재해석될 수 있으므로 셸을 통하지 않는다.
    // 언어를 환경변수로 물려준다 — 안 그러면 마법사는 영어인데 자식 프롬프트만 한국어로 나온다.
    const shimPath = process.platform === 'win32' ? (localPath ?? resolveOnPath(cmd, false)) : null;
    const nodeTarget = process.platform === 'win32' ? windowsNodeTarget(cmd, shimPath) : null;
    if (process.platform === 'win32' && !nodeTarget) {
      process.stderr.write(t().auth.npxFailed(cmd, `could not resolve the JavaScript entrypoint for ${shimPath ?? cmd}`));
      resolve(1);
      return;
    }
    const executable = process.platform === 'win32' ? process.execPath : (localPath ?? cmd);
    const childArgs = nodeTarget ? [nodeTarget, ...args] : args;
    const child = spawn(executable, childArgs, {
      stdio: "inherit",
      shell: false,
      env: { ...process.env, MIMI_SEED_LANG: resolveLang() },
    });
    child.on("error", (e) => {
      process.stderr.write(t().auth.npxFailed(cmd, e.message));
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 0));
  });
}
