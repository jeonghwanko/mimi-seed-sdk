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
    tooMany: (n: number) =>
      `식별자와 맞는 프로세스가 ${n}개라 아무것도 종료하지 않았습니다 — 서버 하나로 보기엔 너무 많습니다. MCP 설정의 args 를 확인하세요.`,
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
    tooMany: (n: number) =>
      `${n} processes match the marker, so nothing was killed — too many for one server. Check the args in the MCP config.`,
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
  'python', 'python3', 'uv', 'uvx', 'pip', 'cmd', 'sh', 'bash', 'zsh', 'powershell', 'pwsh',
  'node_modules', 'dist', 'src', 'lib', 'bin', 'build', 'out', 'app', 'server', 'mcp',
  'index.js', 'index.ts', 'index.mjs', 'index.cjs', 'main.js', 'main.ts', 'server.js', 'server.ts', 'cli.js',
]);
const SCRIPT_RE = /\.(?:[cm]?js|ts)$/i;

/** `/` 와 `\` 를 모두 구분자로 본 마지막 경로 조각 — Windows 명령줄도 같은 규칙으로 비교한다. */
function baseName(value: string): string {
  return value.split(/[\\/]/).pop() ?? value;
}

const normalizePath = (value: string) => value.replace(/\\/g, '/').toLowerCase();

/**
 * 식별자가 될 수 있는 값: 4자 이상, 영문자 포함, 흔한 이름이 아님. 스크립트는 전체 경로로 비교하므로
 * 절대경로면 파일 이름이 `index.js` 여도 된다 — 상대경로(`dist/index.js`)는 다른 서버와 겹친다.
 */
function isSpecificMarker(value: string): boolean {
  const v = value.trim();
  if (v.length < 4 || !/[a-z]/i.test(v)) return false;
  if (SCRIPT_RE.test(v) && (path.posix.isAbsolute(v) || path.win32.isAbsolute(v))) return true;
  return !GENERIC_MARKERS.has(baseName(v).toLowerCase());
}

function findProcessMarker(cfg: Record<string, unknown>): string | null {
  const args = Array.isArray(cfg.args) ? cfg.args.filter((a): a is string => typeof a === 'string') : [];
  // 1순위: 스크립트 파일 경로 (가장 고유)
  const fileArg = args.find((a) => SCRIPT_RE.test(a) && isSpecificMarker(a));
  if (fileArg) return fileArg;
  // 2순위: npm 패키지명 (@ 또는 -가 포함된 식별자)
  const pkgArg = args.find((a) => (a.includes('@') || a.includes('-')) && !a.startsWith('-') && isSpecificMarker(a));
  if (pkgArg) return pkgArg;
  // 3순위: 마지막 의미 있는 arg
  const meaningful = args.filter((a) => !a.startsWith('-') && a !== '/c' && isSpecificMarker(a));
  return meaningful.at(-1) ?? null;
}

/**
 * 프로세스 후보 식별자.
 *
 * `npx -y @yoonion/mimi-seed-mcp` 라도, 전역 설치나 `npm link` 가 있으면 npx 는 링크된
 * bin 을 그대로 exec 한다 — 그 순간 cmdline 에서 패키지명이 사라지고 `mimi-seed-mcp` 만
 * 남는다. 그래서 bin 이름(패키지명의 마지막 세그먼트)도 후보에 넣는다. 스크립트 경로는 전체
 * 경로만 쓴다 — 파일 이름(`index.js`)만으로는 다른 서버와 구분되지 않는다.
 */
function candidateMarkers(cfg: Record<string, unknown>): string[] {
  const primary = findProcessMarker(cfg);
  if (!primary) return [];
  if (SCRIPT_RE.test(primary)) return [primary];
  const base = primary.split('/').pop();
  const executableBase = base?.replace(/@(?:latest|\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?)$/, '');
  return [...new Set([primary, base, executableBase])].filter(
    (value): value is string => typeof value === 'string' && isSpecificMarker(value),
  );
}

/**
 * argv 가 식별자 중 하나와 맞는가. 명령줄 부분일치는 쓰지 않는다 — `pkill -f <marker>` 식으로 하면
 * 자기 자신을 실행한 셸까지, 흔한 문자열이면 무관한 프로세스까지 걸린다. 맞는 경우는:
 *   - 스크립트 식별자: argv 원소의 전체 경로가 같다 (구분자 · 대소문자 무시)
 *   - 패키지/bin 식별자: 실행 파일 이름이 그 bin 이거나, argv 원소(또는 그 파일 이름)가 정확히 같거나,
 *     argv 원소의 연속된 경로 조각이 그 패키지명이다 (`…/node_modules/@scope/pkg/dist/index.js`)
 */
function matchesMarkers(argv: string[], markers: string[]): boolean {
  const exeBase = baseName(argv[0] ?? '').replace(/\.(?:exe|cmd|bat)$/i, '');
  const rest = argv.slice(1);
  return markers.some((marker) => {
    if (SCRIPT_RE.test(marker)) return rest.some((a) => normalizePath(a) === normalizePath(marker));
    const segment = `/${normalizePath(marker.replace(/@(?:latest|\d[\w.+-]*)$/, ''))}/`;
    return exeBase === marker
      || rest.includes(marker)
      || rest.some((a) => baseName(a) === marker)
      || rest.some((a) => `/${normalizePath(a)}/`.includes(segment));
  });
}

/** Windows 명령줄을 argv 로 나눈다 (CommandLineToArgvW 의 따옴표 · 역슬래시 규칙). */
function splitWindowsCommandLine(line: string): string[] {
  const argv: string[] = [];
  let current = '';
  let inQuotes = false;
  let hasToken = false;
  for (let i = 0; i < line.length; i++) {
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
      inQuotes = !inQuotes;
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

type ProcessEntry = { pid: number; argv: string[] };

/** 한 번에 죽일 수 있는 프로세스 상한. 서버 하나는 래퍼 + node 정도라, 이보다 많으면 식별자를 의심한다. */
const MAX_KILL = 10;

/** POSIX: `ps` 로 PID + argv 목록. */
function listPosixProcesses(): ProcessEntry[] {
  let out: string;
  try {
    out = execSync('ps -eo pid=,args=', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return [];
  }
  const list: ProcessEntry[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m) list.push({ pid: Number(m[1]), argv: m[2].split(/\s+/).filter(Boolean) });
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

/** 식별자와 맞는 PID — 자기 자신과 부모(이 명령을 실행한 셸)는 뺀다. */
function findPids(processes: ProcessEntry[], markers: string[]): number[] {
  const skip = new Set<number>([process.pid, process.ppid]);
  return processes.filter((p) => !skip.has(p.pid) && matchesMarkers(p.argv, markers)).map((p) => p.pid);
}

/** 죽일 PID 목록, 또는 상한을 넘어 거부한 개수. */
function planKill(processes: ProcessEntry[], markers: string[]): { pids: number[]; refused: number } {
  const pids = markers.length ? findPids(processes, markers) : [];
  return pids.length > MAX_KILL ? { pids: [], refused: pids.length } : { pids, refused: 0 };
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
  candidateMarkers, matchesMarkers, splitWindowsCommandLine, parseWindowsProcesses, planKill, WINDOWS_PROCESS_QUERY,
};
