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
// tsup 이 빌드 시점에 JSON 을 번들에 인라인한다 — 배포된 dist 도 런타임에 package.json 을 찾지 않는다.
import { version as CLI_VERSION } from "../package.json";

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
  return path.win32.normalize(raw.replace(/%~?dp0%?/gi, `${path.win32.dirname(shimPath)}${path.win32.sep}`));
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

/**
 * PATH 에 bin 이 없을 때 npx 로 받을 패키지 스펙.
 *
 * **이 CLI 와 같은 버전으로 고정한다.** 두 패키지는 루트 버전 하나를 따라 함께 배포되므로
 * (CONTRIBUTING.md), 짝이 맞는 mcp-server 는 언제나 `@<CLI 버전>` 이다. 예전엔 버전 없이
 * `npx @yoonion/mimi-seed-mcp` 를 불러서 npm 의 `latest` 가 무엇이든 받아왔다 — 반쪽 릴리스
 * (cli 만 올라가고 mcp-server 는 실패)나 사용자가 옛 CLI 를 고정해 둔 경우에 CLI 가 모르는
 * bin 인자·파일 형식을 가진 서버와 짝지어졌다. 고정하면 짝이 없을 때 npx 가 "버전 없음"으로
 * 즉시 실패한다 — 조용히 엉뚱한 서버를 돌리는 것보다 낫다.
 *
 * MIMI_SEED_FORCE_NPX 는 "레지스트리 배포판을 써라" 는 개발자용 스위치라 `@latest` 를 유지한다.
 * 전역 `npm link` 가 걸려 있으면 버전 없는 스펙도 PATH 의 **링크된** bin 을 먼저 집어서 결국
 * 체크아웃 코드를 실행한다 (실측으로 확인) — 태그를 붙여야 진짜 배포판을 받아온다.
 */
export function npxPackageSpec(env: NodeJS.ProcessEnv = process.env, version: string = CLI_VERSION): string {
  return env.MIMI_SEED_FORCE_NPX ? `${MCP_PKG}@latest` : `${MCP_PKG}@${version}`;
}

/** setup bin 실행. stdio inherit 이라 대화형 프롬프트가 그대로 사용자에게 보인다. */
export async function runMcpBin(bin: McpBin, extraArgs: string[] = []): Promise<number> {
  const localPath = resolveOnPath(bin);
  const cmd = localPath ? bin : "npx";
  const args = localPath ? extraArgs : ["-y", npxPackageSpec(), bin, ...extraArgs];

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
