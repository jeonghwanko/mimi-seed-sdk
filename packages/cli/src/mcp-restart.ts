import { execSync } from 'node:child_process';
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
    noProcessHint:
      '  이미 종료됐거나, Claude Code가 아직 서버를 시작하지 않은 상태일 수 있습니다.',
    killed: (server: string, n: number) => `✓ ${server} 종료됨 (${n}개 프로세스)`,
    killedHint: '  Claude Code가 다음 도구 호출 시 자동으로 재연결합니다.',
    verify: '  연결 확인: Claude Code에서 /mcp 실행',
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
    noProcessHint:
      '  It may have already exited, or Claude Code may not have started the server yet.',
    killed: (server: string, n: number) => `✓ ${server} killed (${n} process(es))`,
    killedHint: '  Claude Code will reconnect automatically on the next tool call.',
    verify: '  Verify the connection: run /mcp in Claude Code',
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

function findProcessMarker(cfg: Record<string, unknown>): string | null {
  const args = cfg.args as string[] | undefined;
  if (!args) return null;
  // 1순위: .ts / .js 파일 경로 (가장 고유)
  const fileArg = args.find((a) => a.endsWith('.ts') || a.endsWith('.js'));
  if (fileArg) return fileArg;
  // 2순위: npm 패키지명 (@ 또는 -가 포함된 식별자)
  const pkgArg = args.find((a) => (a.includes('@') || a.includes('-')) && !a.startsWith('-') && a !== '-y');
  if (pkgArg) return pkgArg;
  // 3순위: 마지막 의미 있는 arg
  const meaningful = args.filter((a) => !a.startsWith('-') && a !== '/c' && a !== 'npx' && a !== 'cmd');
  return meaningful.at(-1) ?? null;
}

/**
 * 프로세스 후보 식별자.
 *
 * `npx -y @yoonion/mimi-seed-mcp` 라도, 전역 설치나 `npm link` 가 있으면 npx 는 링크된
 * bin 을 그대로 exec 한다 — 그 순간 cmdline 에서 패키지명이 사라지고 `mimi-seed-mcp` 만
 * 남는다. 그래서 bin 이름(패키지명의 마지막 세그먼트)도 후보에 넣는다.
 */
function candidateMarkers(cfg: Record<string, unknown>): string[] {
  const primary = findProcessMarker(cfg);
  if (!primary) return [];
  const base = primary.split('/').pop();
  return base && base !== primary ? [primary, base] : [primary];
}

/**
 * 후보와 일치하는 프로세스 PID.
 *
 * `pkill -f <marker>` 를 쓰면 **자기 자신을 실행한 셸까지** 매칭된다 (셸 명령줄에도 그
 * 문자열이 들어 있으므로). 그래서 cmdline 부분일치가 아니라 "실행 파일이 그 bin 이거나,
 * argv 원소가 정확히 그 패키지/파일인" 경우만 고른다.
 */
function findPids(markers: string[]): number[] {
  let out: string;
  try {
    out = execSync('ps -eo pid=,args=', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return [];
  }
  const skip = new Set<number>([process.pid, process.ppid]);
  const pids: number[] = [];

  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    if (skip.has(pid)) continue;
    const argv = m[2].split(/\s+/).filter(Boolean);
    const exeBase = path.basename(argv[0] ?? '');
    const rest = argv.slice(1);

    const hit = markers.some((marker) => {
      const base = path.basename(marker);
      return exeBase === base || rest.includes(marker) || rest.some((a) => path.basename(a) === base);
    });
    if (hit) pids.push(pid);
  }
  return pids;
}

function killByMarkers(markers: string[]): { killed: number } {
  const isWin = os.platform() === 'win32';
  if (isWin) {
    // PowerShell로 CommandLine에 marker를 포함한 모든 PID 조회
    const escaped = markers[0].replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    let pids: string[];
    try {
      const out = execSync(
        `powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*${escaped}*' } | Select-Object -ExpandProperty ProcessId"`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      pids = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } catch {
      return { killed: 0 };
    }
    let killed = 0;
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
        log(kleur.dim(M().killedPid(pid)));
        killed++;
      } catch { /* ignore: process may have already exited */ }
    }
    return { killed };
  } else {
    let killed = 0;
    for (const pid of findPids(markers)) {
      try {
        process.kill(pid, 'SIGTERM');
        log(kleur.dim(M().killedPid(String(pid))));
        killed += 1;
      } catch { /* 이미 종료됐을 수 있다 */ }
    }
    return { killed };
  }
}

export async function cmdRestart(args: string[]): Promise<void> {
  const serverName = args[0] ?? 'mimi-seed';
  log(kleur.bold(M().title(serverName)));
  log('');

  const { servers, sources } = collectServers();
  const cfg = servers[serverName];

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
  const { killed } = killByMarkers(markers);

  if (killed === 0) {
    log(kleur.yellow(M().noProcess));
    log(kleur.dim(M().noProcessHint));
  } else {
    log('');
    log(kleur.green(M().killed(serverName, killed)));
    log(kleur.dim(M().killedHint));
  }

  log('');
  log(kleur.cyan(M().verify));
}
