import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __testing } from '../mcp-restart.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('MCP 재연결 안내', () => {
  it('Codex 환경을 감지한다', () => {
    expect(__testing.detectMcpClient({ CODEX_THREAD_ID: 'thread-placeholder' })).toBe('codex');
    expect(__testing.detectMcpClient({ CLAUDECODE: '1' })).toBe('claude-code');
    expect(__testing.detectMcpClient({})).toBe('unknown');
  });

  it('Codex transport가 이미 닫혔으면 인증 문제가 아니며 새 thread가 필요하다고 안내한다', () => {
    vi.stubEnv('MIMI_SEED_LANG', 'ko');
    const message = __testing.recoveryMessages('codex', false);
    expect(message.hint).toContain('이 메시지만으로 인증 실패를 뜻하지 않으며');
    expect(message.hint).toContain('현재 thread에 다시 붙일 수 없습니다');
    expect(message.verify).toContain('새 Codex thread');
  });

  it('Codex 플러그인 전용 설치도 기본 mimi-seed 프로세스 식별자를 얻는다', () => {
    const fallback = __testing.resolveServerConfig({}, 'mimi-seed');
    expect(fallback?.args).toEqual(['-y', '@yoonion/mimi-seed-mcp@latest']);
    expect(__testing.resolveServerConfig({}, 'another-server')).toBeUndefined();
  });

  it('명시 등록은 내장 폴백보다 우선한다', () => {
    const configured = { command: 'node', args: ['/tmp/server.js'] };
    expect(__testing.resolveServerConfig({ 'mimi-seed': configured }, 'mimi-seed')).toBe(configured);
  });

  it('Claude Code에만 다음 호출 자동 재연결을 안내한다', () => {
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    const codex = __testing.recoveryMessages('codex', true);
    const claude = __testing.recoveryMessages('claude-code', true);
    expect(codex.hint).not.toContain('automatically');
    expect(codex.hint).toContain('new thread');
    expect(claude.hint).toContain('reconnect automatically');
  });
});

// 설정은 레포가 커밋한 .mcp.json 에서 올 수 있다 — 식별자가 흔한 값이면 무관한 프로세스를 대량으로 죽인다.
describe('restart 식별자 — 흔한 값은 쓰지 않는다', () => {
  it.each([[[' ']], [['/c', 'e']], [['\\']], [['node']], [['-y', 'index.js']], [[42]], [['']], [['.bin']]])(
    'args %j 로는 식별자를 만들지 않는다',
    (args) => {
      expect(__testing.candidateMarkers({ command: 'npx', args })).toEqual([]);
    },
  );

  it('패키지는 패키지명 · bin 이름, 절대경로 스크립트는 그 경로만 쓴다', () => {
    expect(__testing.candidateMarkers({ args: ['-y', '@yoonion/mimi-seed-mcp@latest'] }))
      .toEqual(['@yoonion/mimi-seed-mcp@latest', 'mimi-seed-mcp@latest', 'mimi-seed-mcp']);
    expect(__testing.candidateMarkers({ args: ['/home/dev/mimi-seed-sdk/packages/mcp-server/dist/index.js'] }))
      .toEqual(['/home/dev/mimi-seed-sdk/packages/mcp-server/dist/index.js']);
  });

  it('상대경로 스크립트는 현재 폴더 기준 절대경로로 쓴다', () => {
    expect(__testing.candidateMarkers({ command: 'npx', args: ['tsx', 'src/index.ts'] }, '/home/dev/proj'))
      .toEqual([path.resolve('/home/dev/proj', 'src/index.ts')]);
  });

  it('args 없이 링크된 bin 을 command 로 등록해도 식별자를 얻는다', () => {
    expect(__testing.candidateMarkers({ command: 'mimi-seed-mcp', args: [] })).toEqual(['mimi-seed-mcp']);
    expect(__testing.candidateMarkers({ command: 'C:\\npm\\mimi-seed-mcp.cmd' })).toEqual(['mimi-seed-mcp']);
    expect(__testing.candidateMarkers({ command: 'node', args: [] })).toEqual([]);
    expect(__testing.candidateMarkers({ command: 'github-mcp-server', args: ['stdio'] })).toEqual(['github-mcp-server']);
  });

  it('기본 이름(mimi-seed)은 mimi-seed 서버로 보이는 식별자만 받는다', () => {
    expect(__testing.looksLikeMimiSeed('@yoonion/mimi-seed-mcp@latest')).toBe(true);
    expect(__testing.looksLikeMimiSeed('/home/dev/sdk/packages/mcp-server/dist/index.js')).toBe(true);
    expect(__testing.looksLikeMimiSeed('@anthropic-ai/claude-code')).toBe(false);
    expect(__testing.looksLikeMimiSeed('mimi-seed')).toBe(false); // CLI 자체 — 진행 중인 deploy 를 죽이면 안 된다
  });
});

describe('restart 프로세스 판정', () => {
  const pkg = ['@yoonion/mimi-seed-mcp@latest', 'mimi-seed-mcp@latest', 'mimi-seed-mcp'];
  const win = __testing.splitWindowsCommandLine;
  const cwdOf = (map: Record<number, string> = {}) => (pid: number) => map[pid] ?? null;
  const plan = (
    processes: Array<{ pid: number; argv: string[]; uid?: number }>,
    markers = pkg,
    cwds: Record<number, string> = {},
  ) => __testing.planKill(processes, markers, { uid: 1000, cwdOf: cwdOf(cwds) }).pids;

  it('런타임이 실행 중인 스크립트를 찾는다 — 플래그 · run · python -m 처리', () => {
    expect(__testing.scriptOf(['node', '--enable-source-maps', '-r', 'dotenv/config', '/x/server.js', 'stdio'])).toBe('/x/server.js');
    expect(__testing.scriptOf(['bun', 'run', 'src/index.ts'])).toBe('src/index.ts');
    expect(__testing.scriptOf(['deno', 'run', '-c', 'deno.json', '--allow-net', 'jsr:@scope/pkg'])).toBe('jsr:@scope/pkg');
    expect(__testing.scriptOf(['python3.13t', '-X', 'utf8', '-m', 'mcp_server_git', '--repository', '/r'])).toBe('mcp_server_git');
    expect(__testing.scriptOf(['node', '-e', 'require("mimi-seed-mcp")'])).toBeNull();
    expect(__testing.scriptOf(['node', '--title', 'srv', '--inspect-port', '9230', '/x/a.js'])).toBe('/x/a.js');
    expect(__testing.scriptOf(['bun', '--smol', 'run', 'src/index.ts'])).toBe('src/index.ts');
    expect(__testing.scriptOf(['node', '/p/node_modules/.bin/ts-node', '--transpile-only', 'src/index.ts'])).toBe('src/index.ts');
  });

  it('기본 npx 설정의 서버(node)만 고르고 래퍼는 두고 본다 (POSIX)', () => {
    expect(plan([
      { pid: 11, argv: ['npm', 'exec', '@yoonion/mimi-seed-mcp@latest'] },
      { pid: 12, argv: ['sh', '-c', 'mimi-seed-mcp'] },
      { pid: 13, argv: ['node', '/home/dev/.npm/_npx/abc/node_modules/.bin/mimi-seed-mcp'] },
      { pid: 14, argv: ['/opt/homebrew/bin/node', '/usr/local/lib/node_modules/@yoonion/mimi-seed-mcp/dist/index.js'] },
      { pid: 15, argv: ['node22', '/usr/local/bin/mimi-seed-mcp'] },
    ])).toEqual([13, 14, 15]);
  });

  it('Windows npx · .cmd 셈이 띄운 node 서버만 고른다', () => {
    expect(plan([
      { pid: 21, argv: win('C:\\Windows\\system32\\cmd.exe /c npx -y @yoonion/mimi-seed-mcp@latest') },
      { pid: 22, argv: win('"C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js" -y @yoonion/mimi-seed-mcp@latest') },
      { pid: 23, argv: win('"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\dev\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\@yoonion\\mimi-seed-mcp\\dist\\index.js') },
      { pid: 24, argv: win('Node.exe "C:\\Users\\dev\\AppData\\Roaming\\npm\\node_modules\\@yoonion\\mimi-seed-mcp\\dist\\index.js"') },
      // npm cmd-shim 이 실제로 만드는 형태: %dp0% 가 이미 \ 로 끝나 `.bin\\..\` 이 된다.
      { pid: 25, argv: win('"C:\\Program Files\\nodejs\\node.exe"  "C:\\Users\\dev\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\.bin\\\\..\\@yoonion\\mimi-seed-mcp\\dist\\index.js"') },
    ], ['mimi-seed-mcp'])).toEqual([23, 24, 25]);
  });

  it('pnpm 셈의 `.bin/../` 경로도 정리해서 비교한다', () => {
    expect(plan([{ pid: 26, argv: ['node', '/home/dev/proj/node_modules/.bin/../@yoonion/mimi-seed-mcp/dist/index.js'] }])).toEqual([26]);
  });

  it('식별자가 스크립트가 아닌 자리에 있거나 이름만 겹치면 고르지 않는다', () => {
    expect(plan([
      { pid: 31, argv: ['vim', '/home/u/code/mimi-seed-mcp/src/index.ts'] },
      { pid: 32, argv: ['node', '/home/u/code/mimi-seed-mcp/node_modules/.bin/vitest', '--watch'] },
      { pid: 33, argv: ['node', '/home/u/proj/node_modules/.bin/vitest', 'run', 'mimi-seed-mcp'] },
      { pid: 34, argv: ['bash', '-c', 'mimi-seed', 'restart', '&&', 'echo', 'mimi-seed-mcp'] },
      { pid: 35, argv: ['/bin/bash', '-c', 'source', '/x/snapshot.sh', '&&', 'eval', "'grep", '-rn', 'mimi-seed-mcp', "docs'"] },
      { pid: 36, argv: ['node', '/home/dev/mimi-seed/dist/index.js', 'restart'] },
      { pid: 37, argv: ['node', '/x/serve.js', 'mimi-seed-mcp'] },
    ])).toEqual([]);
  });

  it('런타임이 아닌 프로그램은 식별자로 지목돼도 죽이지 않는다', () => {
    expect(plan([
      { pid: 41, argv: ['/lib/systemd/systemd', '--user'] },
      { pid: 42, argv: win('C:\\Windows\\Explorer.EXE') },
      { pid: 43, argv: ['docker', 'run', '-i', '--rm', 'ghcr.io/example/systemd'] },
    ], ['systemd', 'Explorer'])).toEqual([]);
  });

  it('상대경로로 띄운 서버는 그 프로세스의 작업 폴더로 풀어서 비교한다', () => {
    const marker = [path.resolve('/home/dev/proj', 'src/index.ts')];
    expect(plan([
      { pid: 51, argv: ['node', '/x/tsx/cli.mjs', 'src/index.ts'] },
      { pid: 52, argv: ['node', 'src/index.ts'] },
      { pid: 53, argv: ['node', 'src/index.ts'] },
      { pid: 54, argv: ['node', 'src/index.ts'] },
    ], marker, { 52: path.resolve('/home/dev/proj'), 53: path.resolve('/home/dev/other') })).toEqual([52]);
  });

  it('.py · .mts 스크립트도 경로로 비교한다 — 다른 폴더의 같은 파일 이름은 고르지 않는다', () => {
    const py = __testing.candidateMarkers({ command: 'uv', args: ['run', '--no-project', 'python', 'srv/server.py'] }, '/home/dev/proj');
    expect(py).toEqual([path.resolve('/home/dev/proj', 'srv/server.py')]);
    expect(plan([
      { pid: 55, argv: ['python3', 'srv/server.py'] },
      { pid: 56, argv: ['python3', 'srv/server.py'] },
    ], py, { 55: path.resolve('/home/dev/proj'), 56: path.resolve('/home/dev/other') })).toEqual([55]);
    const mts = __testing.candidateMarkers({ command: 'npx', args: ['tsx', 'src/index.mts'] }, '/home/dev/proj');
    expect(plan([{ pid: 57, argv: ['node', '--import', 'tsx', 'src/index.mts'] }], mts, { 57: path.resolve('/home/dev/other') })).toEqual([]);
  });

  it('스크립트 식별자는 경로가 같을 때만 (구분자 · 대소문자 무시, POSIX 공백 경로 포함)', () => {
    expect(plan([{ pid: 61, argv: win('node C:\\SRV\\mimi\\dist\\index.js --stdio') }], ['C:/srv/mimi/dist/index.js'])).toEqual([61]);
    expect(plan([{ pid: 62, argv: win('node C:\\srv\\other\\dist\\index.js') }], ['C:/srv/mimi/dist/index.js'])).toEqual([]);
    const line = 'node /home/dev/My Projects/mimi/dist/index.js --stdio';
    expect(plan([{ pid: 63, argv: line.split(/\s+/) }], ['/home/dev/My Projects/mimi/dist/index.js'])).toEqual([63]);
    const other = 'node /home/dev/My /home/dev/My Projects/mimi/dist/index.js';
    expect(plan([{ pid: 64, argv: other.split(/\s+/) }], ['/home/dev/My Projects/mimi/dist/index.js'])).toEqual([]);
  });

  it('다른 사용자의 프로세스와 자기 자신은 빼고, 너무 많이 맞으면 하나도 죽이지 않는다', () => {
    const server = (pid: number, uid = 1000) => ({ pid, uid, argv: ['node', '/x/node_modules/@yoonion/mimi-seed-mcp/dist/index.js'] });
    expect(plan([server(101), server(102, 0), server(process.pid)])).toEqual([101]);
    expect(plan(Array.from({ length: __testing.MAX_SERVERS }, (_, i) => server(1000 + i)))).toHaveLength(__testing.MAX_SERVERS);
    const tooMany = Array.from({ length: __testing.MAX_SERVERS + 1 }, (_, i) => server(5000 + i));
    expect(__testing.planKill(tooMany, pkg, { uid: 1000 })).toEqual({ pids: [], refused: __testing.MAX_SERVERS + 1 });
    expect(__testing.planKill([server(101)], [], { uid: 1000 })).toEqual({ pids: [], refused: 0 });
  });

  it('Windows 명령줄을 CommandLineToArgvW 규칙으로 나눈다', () => {
    expect(win('"C:\\Program Files\\nodejs\\node.exe" "C:\\a b\\x.js"  --stdio')).toEqual(['C:\\Program Files\\nodejs\\node.exe', 'C:\\a b\\x.js', '--stdio']);
    expect(win('"C:\\x\\node.exe"x.js y')).toEqual(['C:\\x\\node.exe', 'x.js', 'y']);
    expect(win('"C:\\Program Files\\nodejs\\" x.js')).toEqual(['C:\\Program Files\\nodejs\\', 'x.js']);
    expect(win('p a\\\\\\"b "c\\\\" d')).toEqual(['p', 'a\\"b', 'c\\', 'd']);
    expect(win('p "a""b"')).toEqual(['p', 'a"b']);
    expect(win('x ""')).toEqual(['x', '']);
  });

  it('ConvertTo-Json 의 단일 객체 · 배열 출력을 모두 읽고 명령줄 없는 항목은 뺀다', () => {
    expect(__testing.parseWindowsProcesses('{"ProcessId":7,"CommandLine":"node a.js"}')).toEqual([{ pid: 7, argv: ['node', 'a.js'] }]);
    expect(__testing.parseWindowsProcesses('[{"ProcessId":4,"CommandLine":null},{"ProcessId":8,"CommandLine":"x"}]')).toEqual([{ pid: 8, argv: ['x'] }]);
    expect(__testing.parseWindowsProcesses('not json')).toEqual([]);
  });
});

const shell = os.platform() === 'win32' ? 'powershell' : 'pwsh';
const hasShell = spawnSync(shell, ['-NoProfile', '-Command', 'exit 0']).status === 0;

describe('Windows 프로세스 목록 쿼리', () => {
  // 식별자는 쿼리에 들어가지 않는다 — 상수 스크립트라 주입될 자리가 없다.
  it('쿼리는 상수이고 출력은 UTF-8 JSON 이다', () => {
    expect(__testing.WINDOWS_PROCESS_QUERY).toContain('[Text.Encoding]::UTF8');
    expect(__testing.WINDOWS_PROCESS_QUERY).toContain('ConvertTo-Json');
  });

  it.skipIf(!hasShell)('비ASCII 명령줄도 깨지지 않고 JSON 으로 읽힌다', () => {
    const fake = '@([pscustomobject]@{ ProcessId = 101; CommandLine = $env:FAKE_A }, ' +
      '[pscustomobject]@{ ProcessId = 102; CommandLine = $null })';
    const script = __testing.WINDOWS_PROCESS_QUERY.replace('Get-CimInstance Win32_Process', fake);
    expect(script).not.toBe(__testing.WINDOWS_PROCESS_QUERY);
    const out = execFileSync(shell, ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      env: { ...process.env, FAKE_A: 'node C:\\Users\\개발자\\mimi\\dist\\index.js' },
    });
    expect(__testing.parseWindowsProcesses(out)).toEqual([{ pid: 101, argv: ['node', 'C:\\Users\\개발자\\mimi\\dist\\index.js'] }]);
  });

  it.runIf(os.platform() === 'win32')('실제 Windows 에서 자기 자신을 목록에서 찾는다', () => {
    const out = execFileSync(shell, ['-NoProfile', '-NonInteractive', '-Command', __testing.WINDOWS_PROCESS_QUERY], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(__testing.parseWindowsProcesses(out).some((p) => p.pid === process.pid)).toBe(true);
  });
});
