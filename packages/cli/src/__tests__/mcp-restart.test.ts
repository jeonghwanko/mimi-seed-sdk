import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
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
  it.each([[[' ']], [['/c', 'e']], [['\\']], [['node']], [['-y', 'dist/index.js']], [[42]], [['']]])(
    'args %j 로는 식별자를 만들지 않는다',
    (args) => {
      expect(__testing.candidateMarkers({ command: 'npx', args })).toEqual([]);
    },
  );

  it('패키지는 패키지명·bin 이름을, 스크립트는 전체 경로만 쓴다', () => {
    expect(__testing.candidateMarkers({ args: ['-y', '@yoonion/mimi-seed-mcp@latest'] }))
      .toEqual(['@yoonion/mimi-seed-mcp@latest', 'mimi-seed-mcp@latest', 'mimi-seed-mcp']);
    expect(__testing.candidateMarkers({ args: ['/home/dev/mimi-seed-sdk/packages/mcp-server/dist/index.js'] }))
      .toEqual(['/home/dev/mimi-seed-sdk/packages/mcp-server/dist/index.js']);
  });
});

describe('restart 프로세스 판정', () => {
  const pkg = ['@yoonion/mimi-seed-mcp@latest', 'mimi-seed-mcp@latest', 'mimi-seed-mcp'];
  const win = __testing.splitWindowsCommandLine;

  it('npx 가 띄운 node 서버를 패키지 경로 조각으로 찾는다 (POSIX · Windows)', () => {
    expect(__testing.matchesMarkers(['node', '/home/dev/.npm/_npx/abc/node_modules/@yoonion/mimi-seed-mcp/dist/index.js'], pkg)).toBe(true);
    expect(__testing.matchesMarkers(win('"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\dev\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\@yoonion\\mimi-seed-mcp\\dist\\index.js'), pkg)).toBe(true);
    expect(__testing.matchesMarkers(['/usr/local/bin/mimi-seed-mcp'], pkg)).toBe(true);
  });

  it('부분 문자열만 겹치는 무관한 프로세스는 고르지 않는다', () => {
    expect(__testing.matchesMarkers(['node', '/home/dev/other-mcp/dist/index.js'], pkg)).toBe(false);
    expect(__testing.matchesMarkers(['node', '/home/dev/mimi-seed/dist/index.js', 'restart'], pkg)).toBe(false);
    expect(__testing.matchesMarkers(win('C:\\Windows\\Explorer.EXE'), pkg)).toBe(false);
  });

  it('스크립트 식별자는 전체 경로가 같을 때만 (구분자 · 대소문자 무시)', () => {
    const script = ['C:/srv/mimi/dist/index.js'];
    expect(__testing.matchesMarkers(win('node C:\\SRV\\mimi\\dist\\index.js --stdio'), script)).toBe(true);
    expect(__testing.matchesMarkers(win('node C:\\srv\\other\\dist\\index.js'), script)).toBe(false);
  });

  it('Windows 명령줄을 CommandLineToArgvW 규칙으로 나눈다', () => {
    expect(win('"C:\\Program Files\\nodejs\\node.exe" "C:\\a b\\x.js"  --stdio')).toEqual(['C:\\Program Files\\nodejs\\node.exe', 'C:\\a b\\x.js', '--stdio']);
    expect(win('a\\\\\\"b "c\\\\" d')).toEqual(['a\\"b', 'c\\', 'd']);
    expect(win('x ""')).toEqual(['x', '']);
  });

  it('ConvertTo-Json 의 단일 객체 · 배열 출력을 모두 읽고 명령줄 없는 항목은 뺀다', () => {
    expect(__testing.parseWindowsProcesses('{"ProcessId":7,"CommandLine":"node a.js"}')).toEqual([{ pid: 7, argv: ['node', 'a.js'] }]);
    expect(__testing.parseWindowsProcesses('[{"ProcessId":4,"CommandLine":null},{"ProcessId":8,"CommandLine":"x"}]')).toEqual([{ pid: 8, argv: ['x'] }]);
    expect(__testing.parseWindowsProcesses('not json')).toEqual([]);
  });

  it('자기 자신은 빼고, 너무 많이 맞으면 하나도 죽이지 않는다', () => {
    const server = (pid: number) => ({ pid, argv: ['node', '/x/node_modules/@yoonion/mimi-seed-mcp/dist/index.js'] });
    expect(__testing.planKill([server(101), server(process.pid)], pkg)).toEqual({ pids: [101], refused: 0 });
    const many = Array.from({ length: 11 }, (_, i) => server(1000 + i));
    expect(__testing.planKill(many, pkg)).toEqual({ pids: [], refused: 11 });
    expect(__testing.planKill([server(101)], [])).toEqual({ pids: [], refused: 0 });
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
