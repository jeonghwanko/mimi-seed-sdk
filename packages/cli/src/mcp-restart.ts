import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import kleur from 'kleur';
import { catalog } from './i18n.js';

function log(msg: string) {
  process.stdout.write(msg + '\n');
}

// 이 명령 전용 문구. 공통 문구(setup/doctor/auth)는 i18n.ts 의 `t()` 에 있다.
const M = catalog(
  {
    killedPid: (pid: string) => `  PID ${pid} 종료`,
    title: (server: string) => `MCP 서버 재시작: ${server}`,
    none: '(없음)',
    notFound: (server: string) => `'${server}' 서버를 MCP 설정에서 찾지 못했습니다.`,
    searched: (paths: string) => `  찾아본 곳: ${paths}`,
    noConfig: '(설정 없음)',
    registered: (list: string) => `  등록된 서버: ${list}`,
    httpServer: (server: string) =>
      `'${server}'는 HTTP/SSE 서버입니다. 프로세스 재시작이 필요하지 않습니다.`,
    httpHint: '  Claude Code에서 /mcp 를 실행해 연결 상태를 확인하세요.',
    noMarker: '프로세스 식별자(스크립트 경로)를 찾지 못했습니다.',
    configLine: (cfg: string) => `  설정: ${cfg}`,
    markerLine: (marker: string) => `  식별자: ${marker}`,
    noProcess: '⚠ 실행 중인 프로세스를 찾지 못했습니다.',
    codexNoProcessHint:
      '  Codex의 stdio transport가 이미 닫혔습니다. 이 메시지만으로 인증 실패를 뜻하지 않으며, 이 CLI에서 현재 thread에 다시 붙일 수 없습니다.',
    codexKilledHint:
      '  현재 Codex thread는 종료한 stdio 서버에 다시 붙을 수 없습니다. 새 thread를 시작하거나 Codex를 다시 여세요.',
    codexVerify: '  확인: 새 Codex thread에서 mimi_seed_status 호출',
    claudeNoProcessHint:
      '  이미 종료됐거나, Claude Code가 아직 서버를 시작하지 않은 상태일 수 있습니다.',
    claudeKilledHint: '  Claude Code가 다음 도구 호출 시 자동으로 재연결합니다.',
    claudeVerify: '  연결 확인: Claude Code에서 /mcp 실행',
    genericNoProcessHint:
      '  stdio transport가 이미 닫혔을 수 있습니다. MCP 클라이언트를 다시 열어 연결하세요.',
    genericKilledHint:
      '  stdio 서버는 MCP 클라이언트가 소유합니다. 클라이언트를 다시 열어 연결하세요.',
    genericVerify: '  연결 확인: 새 세션에서 mimi_seed_status 호출',
    unknownWriteOutcome:
      '  직전 호출이 업로드·게시 같은 쓰기였다면 결과가 불명일 수 있습니다. 대상 서비스에서 실제 반영 여부를 확인한 뒤 재시도하세요.',
    killed: (server: string, n: number) => `✓ ${server} 종료됨 (${n}개 프로세스)`,
    notMimiSeed: (marker: string) =>
      `'mimi-seed' 설정의 식별자(${marker})가 mimi-seed MCP 서버로 보이지 않아 아무것도 종료하지 않았습니다. 이 폴더의 .mcp.json 을 확인하세요.`,
    tooMany: (n: number) =>
      `식별자와 맞는 서버 프로세스가 ${n}개라 아무것도 종료하지 않았습니다 — 너무 많습니다. MCP 설정의 args 를 확인하세요.`,
  },
  {
    killedPid: (pid: string) => `  PID ${pid} killed`,
    title: (server: string) => `Restarting MCP server: ${server}`,
    none: '(none)',
    registered: (list: string) => `  Registered servers: ${list}`,
    notFound: (server: string) => `Could not find the '${server}' server in any MCP config.`,
    searched: (paths: string) => `  Looked in: ${paths}`,
    noConfig: '(no config found)',
    httpServer: (server: string) =>
      `'${server}' is an HTTP/SSE server. It does not need a process restart.`,
    httpHint: '  Run /mcp in Claude Code to check the connection.',
    noMarker: 'Could not find a process marker (script path).',
    configLine: (cfg: string) => `  Config: ${cfg}`,
    markerLine: (marker: string) => `  Marker: ${marker}`,
    noProcess: '⚠ No running process found.',
    codexNoProcessHint:
      '  The Codex stdio transport is already closed. This message alone does not prove an auth failure, and this CLI cannot reattach the current thread.',
    codexKilledHint:
      '  The current Codex thread cannot reattach to the terminated stdio server. Start a new thread or reopen Codex.',
    codexVerify: '  Verify: call mimi_seed_status in a new Codex thread',
    claudeNoProcessHint:
      '  It may have already exited, or Claude Code may not have started the server yet.',
    claudeKilledHint: '  Claude Code will reconnect automatically on the next tool call.',
    claudeVerify: '  Verify the connection: run /mcp in Claude Code',
    genericNoProcessHint:
      '  The stdio transport may already be closed. Reopen the MCP client to reconnect.',
    genericKilledHint:
      '  The MCP client owns the stdio server. Reopen the client to reconnect.',
    genericVerify: '  Verify: call mimi_seed_status in a new session',
    unknownWriteOutcome:
      '  If the previous call was a write such as an upload or publish, its outcome may be unknown. Check the target service before retrying.',
    killed: (server: string, n: number) => `✓ ${server} killed (${n} process(es))`,
    notMimiSeed: (marker: string) =>
      `The 'mimi-seed' config's marker (${marker}) does not look like the mimi-seed MCP server, so nothing was killed. Check this folder's .mcp.json.`,
    tooMany: (n: number) =>
      `${n} server processes match the marker, so nothing was killed — too many. Check the args in the MCP config.`,
  },
);

function readJson(filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type ServerMap = Record<string, Record<string, unknown>>;
type McpClientKind = 'codex' | 'claude-code' | 'unknown';

const BUILTIN_MIMI_SEED_SERVER: Record<string, unknown> = {
  command: 'npx',
  args: ['-y', '@yoonion/mimi-seed-mcp@latest'],
};

function detectMcpClient(env: NodeJS.ProcessEnv = process.env): McpClientKind {
  if (env.CODEX_THREAD_ID || env.CODEX_CI || env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE) return 'codex';
  if (env.CLAUDECODE || env.CLAUDE_CODE || env.CLAUDE_CODE_ENTRYPOINT) return 'claude-code';
  return 'unknown';
}

function recoveryMessages(client: McpClientKind, killed: boolean): { hint: string; verify: string } {
  const m = M();
  if (client === 'codex') {
    return { hint: killed ? m.codexKilledHint : m.codexNoProcessHint, verify: m.codexVerify };
  }
  if (client === 'claude-code') {
    return { hint: killed ? m.claudeKilledHint : m.claudeNoProcessHint, verify: m.claudeVerify };
  }
  return { hint: killed ? m.genericKilledHint : m.genericNoProcessHint, verify: m.genericVerify };
}

function resolveServerConfig(servers: ServerMap, serverName: string): Record<string, unknown> | undefined {
  const configured = servers[serverName];
  if (configured) return configured;
  // Codex 플러그인은 자체 .mcp.json 을 로드하므로 현재 프로젝트나 ~/.claude.json 에
  // 등록 흔적이 없을 수 있다. 기본 mimi-seed 이름에만 패키지 고유 식별자를 폴백한다.
  return serverName === 'mimi-seed' ? BUILTIN_MIMI_SEED_SERVER : undefined;
}

/**
 * MCP 서버 등록은 **세 곳**에 흩어져 있다. 예전엔 첫 번째만 봤는데, 정작 이 저장소가
 * 쓰는 두 방식(프로젝트 `.mcp.json`, `projects[cwd].mcpServers`)이 나머지 둘이라
 * `mimi-seed restart` 가 자기 서버를 못 찾았다.
 *
 *   1. ~/.claude.json 의 mcpServers            — `claude mcp add -s user`
 *   2. ~/.claude.json 의 projects[cwd].mcpServers — `claude mcp add` (프로젝트 범위)
 *   3. <cwd>/.mcp.json 의 mcpServers            — 저장소에 커밋하는 방식
 */
function collectServers(): { servers: ServerMap; sources: string[] } {
  const servers: ServerMap = {};
  const sources: string[] = [];
  const add = (map: unknown, source: string) => {
    if (!map || typeof map !== 'object') return;
    const entries = Object.entries(map as ServerMap);
    if (entries.length === 0) return;
    sources.push(source);
    // 먼저 등록된 쪽을 유지한다 — 좁은 범위(프로젝트)가 넓은 범위를 덮지 않도록.
    for (const [name, cfg] of entries) if (!(name in servers)) servers[name] = cfg;
  };

  const projectDir = process.cwd();
  add(readJson(path.join(projectDir, '.mcp.json')).mcpServers, '.mcp.json');

  const home = readJson(path.join(os.homedir(), '.claude.json'));
  const projects = home.projects as Record<string, { mcpServers?: unknown }> | undefined;
  add(projects?.[projectDir]?.mcpServers, '~/.claude.json (projects)');
  add(home.mcpServers, '~/.claude.json');

  return { servers, sources };
}

/**
 * 프로세스 식별자로 쓰기엔 너무 흔한 값. 설정은 레포가 커밋한 `.mcp.json` 에서 올 수도 있어서,
 * `node` · `dist` · `index.js` 같은 값이 식별자가 되면 사용자의 무관한 프로세스를 대량으로 죽인다.
 */
const GENERIC_MARKERS = new Set([
  'node', 'nodejs', 'npx', 'npm', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx', 'deno', 'tsx', 'ts-node',
  'python', 'python3', 'uv', 'uvx', 'pip', 'pipx', 'tool', 'cmd', 'sh', 'bash', 'zsh', 'powershell', 'pwsh',
  'node_modules', '.bin', '.npm', '_npx', 'stdio', 'dist', 'src', 'lib', 'bin', 'build', 'out', 'app', 'server', 'mcp',
  'index.js', 'index.ts', 'index.mjs', 'index.cjs', 'main.js', 'main.ts', 'server.js', 'server.ts', 'cli.js',
]);
const SCRIPT_RE = /\.(?:[cm]?[jt]s|py)$/i;
const WIN_EXE_RE = /\.(?:exe|cmd|bat)$/i;
/**
 * 좁은 버전 접미사: `@latest` · `@next` · semver (`@1`, `@0.21`, `@0.21.2`, `@1.0.0-beta.1+build`). 프리릴리스 ·
 * 빌드 표기는 x.y.z 뒤에서만 받는다 — `@10.0.0.5`(IP) · `@1-build`(호스트명)는 버전이 아니다.
 */
const VERSION_RE = /@(?:latest|next|\d+(?:\.\d+){0,2}|\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)$/;
/**
 * 패키지 식별자의 버전 · 태그 · 범위 (`@latest`, `@beta`, `@^0.21`). 패키지 실행기(npx 등)로 등록했을 때만 뗀다 —
 * 그 밖의 `user@host` 같은 인자에서 떼면 `user` 처럼 너무 넓은 식별자가 생긴다. `:` 가 든 값(digest, `npm:` 별칭)은 버전이 아니다.
 */
const PACKAGE_VERSION_RE = /@[^@/\\:]+$/; // 공백 든 범위(`@>=0.21 <1`)도
/** 패키지 실행기 — 바로 실행(npx 등) 또는 하위 명령이 붙는 것(`npm exec`, `bun x`, `pnpm dlx` …). */
const DIRECT_RUNNERS = new Set(['npx', 'bunx', 'pnpx', 'uvx']);
const RUNNER_SUBCOMMANDS: Record<string, string[]> = { npm: ['exec', 'x'], bun: ['x'], pnpm: ['dlx'], yarn: ['dlx'], pipx: ['run'] };
/** 실행기 앞에 올 수 있는 셸 래퍼, 그리고 실행기 뒤에서 값을 받는 플래그 (`--package` 의 값은 패키지라 건너뛰지 않는다). */
const SHELL_WRAPPERS = new Set(['cmd', 'sh', 'bash', 'zsh', 'dash', 'powershell', 'pwsh']);
const RUNNER_FLAGS_WITH_VALUE = new Set([
  '--registry', '--cache', '--userconfig', '--globalconfig', '--prefix', '-w', '--workspace', '-c', '--call',
  '--node-options', '--shell', '--script-shell', '--python', '--index-url', '--from', '--loglevel', '--location',
  '--with', '--with-editable', '--with-requirements',
]);
/** 셸 래퍼(PowerShell) · env 에서 값을 받는 플래그 — 그 값을 실행기로 읽지 않는다. 셸의 `-c` · `/c` 는 값이 아니라 명령이 뒤따른다. */
const SHELL_FLAGS_WITH_VALUE = new Set(['-executionpolicy', '-ep', '-workingdirectory', '-wd', '-windowstyle', '-inputformat', '-outputformat']);
const ENV_FLAGS_WITH_VALUE = new Set(['-u', '--unset', '-c', '--chdir', '-p']); // -P altpath (BSD). -S 의 값은 명령 자체라 넣지 않는다.

/**
 * 패키지 실행기가 실행하는 패키지 인자의 위치. 실행기는 `command` 자리(또는 `cmd /c` · `sh -c` 바로 뒤)에 있어야
 * 한다 — 인자 어딘가에 `npx` 라는 글자가 있다고 실행기로 보지 않는다. 없으면 null.
 */
function runnerPackageIndex(cfg: Record<string, unknown>): number | null {
  const args = Array.isArray(cfg.args) ? cfg.args.map((a) => (typeof a === 'string' ? a : '')) : [];
  const word = (v: unknown) => (typeof v === 'string' ? baseName(v).toLowerCase().replace(WIN_EXE_RE, '') : '');
  let program = word(cfg.command);
  let i = 0;
  if (SHELL_WRAPPERS.has(program)) {
    // /c /d /s -c -l -NoProfile -Command, 그리고 -ExecutionPolicy Bypass 처럼 값을 받는 것
    while (i < args.length && /^(?:\/[a-z]|-[a-z]+(?::\S+)?)$/i.test(args[i])) { // -ExecutionPolicy:Bypass 도
      i += SHELL_FLAGS_WITH_VALUE.has(args[i].toLowerCase()) ? 2 : 1;
    }
    program = word(args[i]);
    i++;
  }
  if (program === 'env') {
    // env -i -u FOO -C dir KEY=1 npx …
    while (i < args.length && (args[i].startsWith('-') || args[i].includes('='))) { // env 는 `=` 든 인자를 모두 대입으로 본다
      i += ENV_FLAGS_WITH_VALUE.has(args[i].toLowerCase()) ? 2 : 1;
    }
    program = word(args[i]);
    i++;
  }
  const subcommands = RUNNER_SUBCOMMANDS[program];
  if (subcommands) {
    if (!subcommands.includes((args[i] ?? '').toLowerCase())) return null;
    i++;
  } else if (!DIRECT_RUNNERS.has(program)) {
    return null;
  }
  while (i < args.length && args[i].startsWith('-')) {
    if (RUNNER_FLAGS_WITH_VALUE.has(args[i].toLowerCase())) i++; // --registry <url> 의 값은 패키지가 아니다
    i++; // -y, --yes, --quiet …
  }
  return i < args.length && !args[i].includes('://') ? i : null;
}

/**
 * 서버 프로세스를 실행하는 런타임 (node · node22 · bun · deno · python3.12 · python3.13t · pythonw · pypy3 …).
 * 종료 대상은 이 런타임이 **실행 중인 스크립트**가 식별자와 맞는 프로세스뿐이다. 셸 · `npm exec` · `npx` ·
 * `cmd /c` 같은 래퍼는 자식이 끝나면 스스로 끝나므로 건드리지 않는다 — 래퍼의 `-c "…"` 문자열은 `ps` 가
 * 토큰으로 쪼개 보여 주므로, 거기서 식별자를 찾으면 무관한 셸까지 걸린다. 설정이 `systemd` · `explorer`
 * 같은 이름을 내밀어도 런타임이 아니니 걸리지 않는다. Docker · 네이티브 바이너리 서버는 대상이 아니다.
 */
const RUNTIME_RE = /^(?:node(?:js)?\d*|bun|deno|python(?:\d+(?:\.\d+)?t?)?|pythonw|pypy\d*|py)$/;
/** 다음 원소를 값으로 받는 런타임 플래그 — 그 값은 스크립트가 아니다. */
const FLAGS_WITH_VALUE = new Set([
  '-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions', '--env-file',
  '--title', '--inspect-port', '--debug-port', '--disable-warning', '--watch-path', '--input-type',
  '--unhandled-rejections', '--redirect-warnings', '--report-dir', '--report-directory', '--report-filename',
  '--report-signal', '--diagnostic-dir', '--heapsnapshot-signal', '--icu-data-dir', '--openssl-config',
  '--tls-cipher-list', '--secure-heap', '--secure-heap-min', '--experimental-policy', '--policy-integrity',
  '--config', '--import-map', '-W', '-X',
]);
/**
 * 같은 프로세스 안에서 다음 인자를 스크립트로 실행하는 로더(ts-node). 파일 이름이 아니라 설치 위치로 안다 —
 * 사용자 스크립트 이름이 우연히 `ts-node.js` 여도 로더로 보지 않는다. Windows 셈은 `ts-node/dist/bin.js` 로 띄운다.
 */
const IN_PROCESS_LOADER_RE =
  /\/(?:node_modules\/\.bin|bin)\/ts-node(?:-esm|-script|-transpile-only|-cwd)?$|\/node_modules\/ts-node\/dist\/bin(?:-[\w-]+)?\.js$/;
/** ts-node 자신의 값 받는 플래그 — 로더 뒤에서만 쓴다 (python `-P` 처럼 다른 런타임에선 뜻이 다르다). */
const LOADER_FLAGS_WITH_VALUE = new Set([
  '-P', '--project', '-O', '--compiler-options', '-C', '--compiler', '-I', '--ignore', '-D', '--ignore-diagnostics',
  '--transpiler', '--dir', '--scope-dir', '--cwd',
]);

/** `/` 와 `\` 를 모두 구분자로 본 마지막 경로 조각 — Windows 명령줄도 같은 규칙으로 비교한다. */
function baseName(value: string): string {
  return value.split(/[\\/]/).pop() ?? value;
}

/** 비교용 경로: 구분자 통일 · 소문자 · `..`/`//` 정리 (npm .cmd 셈은 `…\\.bin\\\\..\\<패키지>\\…` 로 띄운다). */
const normalizePath = (value: string) => path.posix.normalize(value.replace(/\\/g, '/').toLowerCase());
/** 실행 파일 이름: 경로 · 확장자(.exe/.cmd)를 뗀 소문자. */
const programName = (argv0: string) => baseName(argv0).toLowerCase().replace(WIN_EXE_RE, '');
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAbsoluteScript = (value: string) => path.posix.isAbsolute(value) || path.win32.isAbsolute(value);

/**
 * 식별자가 될 수 있는 값: 4자 이상, 영문자 포함, 흔한 이름이 아님. 스크립트는 경로로 비교하므로 절대경로나
 * 디렉터리가 붙은 상대경로면 파일 이름이 `index.js` 여도 된다 — 파일 이름만으로는 다른 서버와 겹친다.
 */
function isSpecificMarker(value: string): boolean {
  const v = value.trim();
  if (v.length < 4 || !/[a-z]/i.test(v)) return false;
  if (SCRIPT_RE.test(v) && (isAbsoluteScript(v) || /[\\/]/.test(v))) return true;
  return !GENERIC_MARKERS.has(baseName(v).toLowerCase().replace(WIN_EXE_RE, ''));
}

function findProcessMarker(cfg: Record<string, unknown>): string | null {
  const args = Array.isArray(cfg.args) ? cfg.args.filter((a): a is string => typeof a === 'string') : [];
  // 1순위: 스크립트 파일 경로 (가장 고유)
  const fileArg = args.find((a) => SCRIPT_RE.test(a) && isSpecificMarker(a));
  if (fileArg) return fileArg;
  // 2순위: npm 패키지명 (@ 또는 -가 포함된 식별자)
  // `KEY=value`(대입) · URL(`--registry` 값)은 식별자가 아니다. 대입의 `=` 는 `@` 앞에 오고,
  // 버전 범위(`@>=0.21`)의 `=` 는 `@` 뒤에 온다.
  const notValue = (a: string) => !/^[^@/\\]*=/.test(a) && !a.includes('://'); // 경로 속 `=`(`/home/x=y/…`)는 대입이 아니다
  const pkgArg = args.find((a) => (a.includes('@') || a.includes('-')) && !a.startsWith('-') && notValue(a) && isSpecificMarker(a));
  if (pkgArg) return pkgArg;
  // 3순위: 마지막 의미 있는 arg
  const meaningful = args.filter((a) => !a.startsWith('-') && notValue(a) && a.toLowerCase() !== '/c' && isSpecificMarker(a));
  if (meaningful.length) return meaningful.at(-1) ?? null;
  // 4순위: 링크된 bin 을 command 로 직접 등록한 경우 (`command: "mimi-seed-mcp"`, args 없음)
  const command = typeof cfg.command === 'string' ? baseName(cfg.command).replace(WIN_EXE_RE, '') : '';
  const program = command.toLowerCase();
  return command && !RUNTIME_RE.test(program) && isSpecificMarker(command) ? command : null;
}

/**
 * 프로세스 후보 식별자.
 *
 * `npx -y @yoonion/mimi-seed-mcp` 라도, 전역 설치나 `npm link` 가 있으면 npx 는 링크된
 * bin 을 그대로 exec 한다 — 그 순간 cmdline 에서 패키지명이 사라지고 `mimi-seed-mcp` 만
 * 남는다. 그래서 bin 이름(패키지명의 마지막 세그먼트)도 후보에 넣는다. 스크립트는 절대경로로 쓴다 —
 * 상대경로면 지금 폴더 기준으로 풀고, 프로세스 쪽도 그 프로세스의 작업 폴더 기준으로 풀어 비교한다.
 */
function candidateMarkers(cfg: Record<string, unknown>, cwd: string = process.cwd()): string[] {
  const primary = findProcessMarker(cfg);
  if (!primary) return [];
  if (SCRIPT_RE.test(primary)) return [isAbsoluteScript(primary) ? primary : path.resolve(cwd, primary)];
  const base = baseName(primary).replace(WIN_EXE_RE, '');
  // 범위 · 태그(`@^0.21`, `@beta`)는 실행기가 실행하는 패키지 인자에서만 뗀다. 그 밖엔 semver 만.
  const packageIndex = runnerPackageIndex(cfg);
  const isRunnerPackage = packageIndex !== null && Array.isArray(cfg.args) && cfg.args[packageIndex] === primary;
  const executableBase = base.replace(isRunnerPackage ? PACKAGE_VERSION_RE : VERSION_RE, '');
  return [...new Set([primary, base, executableBase])].filter(
    (value): value is string => typeof value === 'string' && isSpecificMarker(value),
  );
}

/**
 * 런타임이 실행 중인 스크립트(또는 `python -m` 모듈). 플래그와 그 값을 건너뛴 첫 인자다 — `node [플래그] <스크립트>`,
 * `bun run <스크립트>`, `deno run [플래그] <스크립트>`. 인라인 코드(`node -e`, `python -c`)는 스크립트가 없다.
 */
function scriptOf(argv: string[], loaderFlags: ReadonlySet<string> = new Set()): string | null {
  const program = programName(argv[0] ?? '');
  const isPython = program.startsWith('py');
  const hasRunVerb = program === 'bun' || program === 'deno';
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (isPython && a === '-m') return argv[i + 1] ?? null;
    if ((isPython && a === '-c') || (!isPython && ['-e', '--eval', '-p', '--print'].includes(a))) return null;
    if (FLAGS_WITH_VALUE.has(a) || loaderFlags.has(a) || (program === 'deno' && a === '-c')) { i++; continue; }
    if (a.startsWith('-')) continue;
    if (hasRunVerb && a === 'run') continue; // `bun --smol run x`, `deno run --allow-net x`
    // `node …/.bin/ts-node src/index.ts` — ts-node 는 같은 프로세스에서 다음 인자를 실행한다.
    if (!isPython && IN_PROCESS_LOADER_RE.test(`/${normalizePath(a)}`)) {
      return scriptOf([argv[0] ?? '', ...argv.slice(i + 1)], LOADER_FLAGS_WITH_VALUE);
    }
    return a;
  }
  return null;
}

type PackageJson = { name?: unknown; bin?: unknown; main?: unknown };
type MatchContext = { processCwd?: () => string | null; readPackageJson?: (dir: string) => PackageJson | null };

function readPackageJsonFile(dir: string): PackageJson | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * `…/node_modules/<패키지>/…` 아래 스크립트가 그 패키지의 **해당 bin 진입점**인가. 같은 패키지의 다른 bin
 * (`mimi-seed-auth` 의 `dist/auth/cli.js` 같은 설정 마법사)까지 죽이지 않으려는 것. package.json 을 못 읽으면
 * 관례적인 `dist/index.js` 만 인정한다.
 */
function isPackageEntry(original: string, packageDir: string, binName: string, read: (dir: string) => PackageJson | null): boolean {
  const pkg = read(packageDir);
  const rest = original.slice(packageDir.length + 1).toLowerCase();
  if (!pkg) return rest === 'dist/index.js';
  const bin = pkg.bin;
  const target = typeof bin === 'string' ? bin
    : bin && typeof bin === 'object' && typeof (bin as Record<string, unknown>)[binName] === 'string'
      ? (bin as Record<string, string>)[binName]
      : typeof pkg.main === 'string' ? pkg.main : null;
  return target !== null && normalizePath(target) === rest;
}

/**
 * 런타임 프로세스의 스크립트가 식별자와 맞는가. 명령줄 부분일치는 쓰지 않는다. 맞는 경우는:
 *   - 스크립트 식별자(절대경로): 스크립트 경로가 같다 (구분자 · 대소문자 무시). 상대경로로 띄운 프로세스는
 *     그 프로세스의 작업 폴더 기준으로 풀어서 비교한다 — 다른 프로젝트의 같은 상대경로는 걸리지 않는다.
 *     POSIX `ps` 는 공백으로만 나눠 주므로, 공백이 든 경로는 스크립트 자리부터 argv 를 이어 붙여 비교한다.
 *   - 패키지/bin 식별자: 스크립트 파일 이름(버전 · 확장자 제외)이 bin 이름이거나, 스크립트가
 *     `node_modules/<패키지>/` 아래다. 아무 폴더 이름과 겹치는 것(`~/code/mimi-seed-mcp/…`)은 아니다.
 */
function matchesMarkers(argv: string[], markers: string[], ctx: MatchContext = {}): boolean {
  if (!RUNTIME_RE.test(programName(argv[0] ?? ''))) return false;
  const script = scriptOf(argv);
  if (!script) return false;
  const s = normalizePath(script);
  let resolved: string | null | undefined;
  const absoluteScript = () => {
    if (resolved === undefined) {
      const cwd = isAbsoluteScript(script) ? null : ctx.processCwd?.() ?? null;
      resolved = isAbsoluteScript(script) ? s : cwd ? normalizePath(path.resolve(cwd, script)) : null;
    }
    return resolved;
  };
  const read = ctx.readPackageJson ?? readPackageJsonFile;
  return markers.some((marker) => {
    if (SCRIPT_RE.test(marker)) {
      const wanted = normalizePath(marker);
      // 파일 이름이 같을 때만 작업 폴더를 묻는다 — macOS 는 프로세스마다 lsof 를 띄운다.
      if (baseName(s) === baseName(wanted) && absoluteScript() === wanted) return true;
      if (!wanted.includes(' ') || !isAbsoluteScript(script)) return false;
      // 공백 든 경로: 스크립트 자리부터 토큰을 하나씩 늘려 붙인 경로가 정확히 같아야 한다. 여기서는 `..` 를
      // 접지 않는다 — 접으면 뒤 인자(`/../x`)가 앞 경로를 지워 다른 경로처럼 보이게 만든다.
      const start = argv.indexOf(script, 1);
      for (let end = start + 2; end <= argv.length; end++) {
        if (argv.slice(start, end).join(' ').replace(/\\/g, '/').toLowerCase() === wanted) return true;
      }
      return false;
    }
    const name = normalizePath(marker.replace(WIN_EXE_RE, '').replace(VERSION_RE, ''));
    const binName = baseName(name);
    // 링크된 bin (`…/.bin/mimi-seed-mcp`, `/usr/local/bin/mimi-seed-mcp`) — 파일 이름이 곧 bin 이름이다.
    if (s === name || baseName(s).replace(/\.(?:[cm]?js|ts|exe|cmd)$/, '').replace(VERSION_RE, '') === binName) return true;
    // 패키지 폴더에서 직접 (`…/node_modules/@scope/pkg/dist/index.js`) — 그 bin 의 진입점일 때만.
    const original = path.posix.normalize(script.replace(/\\/g, '/'));
    // 원래 경로에 대소문자 무시로 찾는다 — 소문자로 바꾼 문자열의 위치로 자르면 `İ` 처럼 길이가 바뀌는 글자에서 어긋난다.
    const pattern = name.includes('/')
      ? new RegExp(`/node_modules/${escapeRegExp(name)}(?=/)`, 'i')
      : new RegExp(`/node_modules/(?:@[^/]+/)?${escapeRegExp(name)}(?=/)`, 'i');
    const m = pattern.exec(`/${original}`);
    if (!m) return false;
    const packageDir = original.slice(0, m.index + m[0].length - 1);
    return isPackageEntry(original, packageDir, binName, read);
  });
}

/**
 * Windows 명령줄을 argv 로 나눈다 (CommandLineToArgvW 규칙). 첫 원소(프로그램)는 따옴표 안을 그대로 쓰고
 * 역슬래시를 해석하지 않는다. 나머지는 2N 개 역슬래시 + `"` → N 개 + 따옴표 토글, 따옴표 안의 `""` → `"`.
 */
function splitWindowsCommandLine(line: string): string[] {
  let i = 0;
  let program = '';
  if (line[0] === '"') {
    const close = line.indexOf('"', 1);
    program = close === -1 ? line.slice(1) : line.slice(1, close);
    i = close === -1 ? line.length : close + 1;
  } else {
    while (i < line.length && line[i] !== ' ' && line[i] !== '\t') program += line[i++];
  }
  const argv = [program];
  let current = '';
  let inQuotes = false;
  let hasToken = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') {
      let n = 0;
      while (line[i + n] === '\\') n++;
      if (line[i + n] === '"') {
        current += '\\'.repeat(Math.floor(n / 2));
        if (n % 2 === 1) current += '"';
        else inQuotes = !inQuotes;
        i += n;
      } else {
        current += '\\'.repeat(n);
        i += n - 1;
      }
      hasToken = true;
    } else if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
      hasToken = true;
    } else if ((c === ' ' || c === '\t') && !inQuotes) {
      if (hasToken) argv.push(current);
      current = '';
      hasToken = false;
    } else {
      current += c;
      hasToken = true;
    }
  }
  if (hasToken) argv.push(current);
  return argv;
}

type ProcessEntry = { pid: number; argv: string[]; uid?: number };

/** 한 번에 재시작할 수 있는 서버 프로세스 수 상한. 열린 세션 여러 개는 괜찮고, 그보다 많으면 식별자를 의심한다. */
const MAX_SERVERS = 10;

/** POSIX: `ps` 로 PID · 소유자 · argv 목록. */
function listPosixProcesses(): ProcessEntry[] {
  let out: string;
  try {
    out = execSync('ps -eo pid=,uid=,args=', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return [];
  }
  const list: ProcessEntry[] = [];
  for (const row of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row);
    if (m) list.push({ pid: Number(m[1]), uid: Number(m[2]), argv: m[3].split(/\s+/).filter(Boolean) });
  }
  return list;
}

/** Windows 시스템 도구는 절대경로로 — 이름만 주면 현재 폴더(레포)에 놓인 같은 이름 exe 를 먼저 찾는다. */
function systemExe(...segments: string[]): string {
  return path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', ...segments);
}

/**
 * Windows: 모든 프로세스의 PID + 명령줄을 JSON 으로 받는다. 식별자는 PowerShell 에 넘기지 않고
 * 판정은 JS(matchesMarkers)가 한다 — 스크립트가 상수라 주입될 자리가 없다. 비ASCII 경로(한글 사용자
 * 폴더 등)가 깨지지 않게 출력은 UTF-8 로 받는다.
 */
const WINDOWS_PROCESS_QUERY =
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ' +
  'Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress';

/** ConvertTo-Json 은 결과가 하나면 배열이 아니라 객체를 낸다 — 둘 다 받는다. */
function parseWindowsProcesses(json: string): ProcessEntry[] {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return []; }
  const list: ProcessEntry[] = [];
  for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
    if (!row || typeof row !== 'object') continue;
    const { ProcessId: pid, CommandLine: line } = row as { ProcessId?: unknown; CommandLine?: unknown };
    if (typeof pid === 'number' && Number.isInteger(pid) && typeof line === 'string' && line) {
      list.push({ pid, argv: splitWindowsCommandLine(line) });
    }
  }
  return list;
}

function listWindowsProcesses(): ProcessEntry[] {
  try {
    const out = execFileSync(
      systemExe('WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROCESS_QUERY],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
    );
    return parseWindowsProcesses(out);
  } catch {
    return [];
  }
}

const MIMI_SEED_PACKAGE = '@yoonion/mimi-seed-mcp';

/**
 * mimi-seed MCP 서버 식별자인가 (기본 이름 `mimi-seed` 보호용). 패키지 식별자는 이 패키지 · bin 이름 그대로여야
 * 하고 — `evil-mimi-seed-mcp/vitest` 처럼 글자만 섞인 것은 아니다 — 스크립트는 경로를 풀어 가장 가까운
 * package.json 이 이 패키지여야 한다 (`packages/mcp-server` 는 흔한 폴더 이름이고, `…/../` 로 위장할 수 있다).
 */
function looksLikeMimiSeed(marker: string, read: (dir: string) => PackageJson | null = readPackageJsonFile): boolean {
  if (SCRIPT_RE.test(marker)) {
    // 스크립트는 이 패키지의 서버 진입점이어야 한다 — 같은 패키지의 설정 마법사(dist/auth/cli.js 등)는 아니다.
    const file = path.resolve(marker);
    let dir = path.dirname(file);
    for (let depth = 0; depth < 6; depth++) {
      const pkg = read(dir);
      if (pkg) {
        if (pkg.name !== MIMI_SEED_PACKAGE) return false;
        const rest = normalizePath(path.relative(dir, file));
        const bin = pkg.bin && typeof pkg.bin === 'object' ? (pkg.bin as Record<string, unknown>)['mimi-seed-mcp'] : null;
        return rest === 'src/index.ts' || rest === normalizePath(typeof bin === 'string' ? bin : 'dist/index.js');
      }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    return false;
  }
  // 경로로 적은 링크된 bin (`/usr/local/bin/mimi-seed-mcp`)은 파일 이름으로 본다. 버전은 범위(`@^0.21`)도 받는다.
  const name = /[\\/]/.test(marker) && !marker.startsWith('@') ? baseName(marker).replace(WIN_EXE_RE, '') : marker;
  return /^(?:@yoonion\/)?mimi-seed-mcp(?:@[^/\\]+)?$/i.test(name);
}

/**
 * 상대경로 스크립트를 풀 때 쓰는 그 프로세스의 작업 폴더. Linux 는 /proc, macOS 는 lsof(절대경로).
 * Windows 는 Win32_Process 에 작업 폴더가 없어 알 수 없다 — 그때 상대경로 프로세스는 고르지 않는다.
 */
function processCwd(pid: number): string | null {
  try {
    if (process.platform === 'linux') return fs.readlinkSync(`/proc/${pid}/cwd`);
    if (process.platform === 'darwin') {
      const out = execFileSync('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fn', '-p', String(pid)], { encoding: 'utf8', stdio: 'pipe' });
      return out.split('\n').find((l) => l.startsWith('n'))?.slice(1) ?? null;
    }
  } catch { /* 이미 끝났거나 권한 없음 */ }
  return null;
}

/**
 * 죽일 PID 목록, 또는 상한을 넘어 거부한 서버 수. 대상은 자기 자신 · 부모를 뺀, 같은 사용자 소유(POSIX)의
 * 런타임 프로세스 중 스크립트가 식별자와 맞는 것뿐이다.
 */
function planKill(
  processes: ProcessEntry[],
  markers: string[],
  {
    uid = process.getuid?.(),
    cwdOf = processCwd,
    readPackageJson = readPackageJsonFile,
  }: { uid?: number; cwdOf?: (pid: number) => string | null; readPackageJson?: (dir: string) => PackageJson | null } = {},
): { pids: number[]; refused: number } {
  if (markers.length === 0) return { pids: [], refused: 0 };
  const skip = new Set<number>([process.pid, process.ppid]);
  const pids = processes
    .filter((p) => !skip.has(p.pid) && (uid === undefined || p.uid === undefined || p.uid === uid))
    .filter((p) => matchesMarkers(p.argv, markers, { processCwd: () => cwdOf(p.pid), readPackageJson }))
    .map((p) => p.pid);
  return pids.length > MAX_SERVERS ? { pids: [], refused: pids.length } : { pids, refused: 0 };
}

function killByMarkers(markers: string[]): { killed: number; refused: number } {
  if (markers.length === 0) return { killed: 0, refused: 0 };
  const isWin = os.platform() === 'win32';
  const { pids, refused } = planKill(isWin ? listWindowsProcesses() : listPosixProcesses(), markers);
  if (refused) return { killed: 0, refused };

  let killed = 0;
  for (const pid of pids) {
    try {
      if (isWin) execFileSync(systemExe('taskkill.exe'), ['/F', '/PID', String(pid)], { stdio: 'pipe' });
      else process.kill(pid, 'SIGTERM');
      log(kleur.dim(M().killedPid(String(pid))));
      killed += 1;
    } catch { /* 이미 종료됐을 수 있다 */ }
  }
  return { killed, refused: 0 };
}

export async function cmdRestart(args: string[]): Promise<void> {
  const serverName = args[0] ?? 'mimi-seed';
  log(kleur.bold(M().title(serverName)));
  log('');

  const { servers, sources } = collectServers();
  const cfg = resolveServerConfig(servers, serverName);

  if (!cfg) {
    const names = Object.keys(servers);
    const available = names.length ? names.join(', ') : M().none;
    log(kleur.red(M().notFound(serverName)));
    log(kleur.dim(M().searched(sources.length ? sources.join(', ') : M().noConfig)));
    log(kleur.dim(M().registered(available)));
    process.exit(1);
  }

  if (cfg.type === 'http' || cfg.type === 'sse') {
    log(kleur.yellow(M().httpServer(serverName)));
    log(kleur.dim(M().httpHint));
    return;
  }

  const markers = candidateMarkers(cfg);
  const marker = markers[0] ?? null;
  if (!marker) {
    log(kleur.yellow(M().noMarker));
    log(kleur.dim(M().configLine(JSON.stringify(cfg))));
    process.exit(1);
  }
  // 기본 이름은 레포의 `.mcp.json` 이 가로챌 수 있다 — mimi-seed 서버로 보이지 않는 식별자로는 아무것도 죽이지 않는다.
  if (serverName === 'mimi-seed' && !markers.every((m) => looksLikeMimiSeed(m))) {
    log(kleur.red(M().notMimiSeed(marker)));
    log(kleur.dim(M().configLine(JSON.stringify(cfg))));
    process.exit(1);
  }

  log(kleur.dim(M().markerLine(marker)));
  const { killed, refused } = killByMarkers(markers);
  if (refused > 0) {
    log(kleur.red(M().tooMany(refused)));
    log(kleur.dim(M().configLine(JSON.stringify(cfg))));
    process.exit(1);
  }
  const recovery = recoveryMessages(detectMcpClient(), killed > 0);

  if (killed === 0) {
    log(kleur.yellow(M().noProcess));
    log(kleur.dim(recovery.hint));
    log(kleur.yellow(M().unknownWriteOutcome));
  } else {
    log('');
    log(kleur.green(M().killed(serverName, killed)));
    log(kleur.dim(recovery.hint));
  }

  log('');
  log(kleur.cyan(recovery.verify));
}

export const __testing = {
  detectMcpClient, recoveryMessages, resolveServerConfig,
  candidateMarkers, matchesMarkers, scriptOf, splitWindowsCommandLine, parseWindowsProcesses, planKill, WINDOWS_PROCESS_QUERY, MAX_SERVERS, looksLikeMimiSeed,
};
