import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
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

// marker 는 레포가 커밋한 .mcp.json 에서 올 수 있다 — PowerShell 은 ’ ‘ 같은 둥근 따옴표도
// 문자열 구분자로 받으므로, 이스케이프가 아니라 스크립트 밖(환경변수)으로 넘겨야 안전하다.
const SMART_QUOTE_PAYLOAD = 'C:\\srv\\mimi-seed-mcp\u2019 + $(New-Item -ItemType File -Path pwned) + \u2019';
const shell = os.platform() === 'win32' ? 'powershell' : 'pwsh';
const hasShell = spawnSync(shell, ['-NoProfile', '-Command', 'exit 0']).status === 0;

describe('Windows restart PID query', () => {
  it('keeps the marker out of the PowerShell script and passes it as data', () => {
    const { args, env } = __testing.windowsPidQuery(SMART_QUOTE_PAYLOAD);
    expect(args.join(' ')).not.toContain('pwned');
    expect(env.MIMI_SEED_MARKER).toBe(SMART_QUOTE_PAYLOAD);
  });

  it.skipIf(!hasShell)('matches case-insensitively and never runs code from the marker', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-restart-test-'));
    try {
      const { args, env } = __testing.windowsPidQuery(SMART_QUOTE_PAYLOAD);
      // Get-WmiObject 대신 가짜 프로세스 목록 — 명령줄도 환경변수로 넣어 테스트 쪽 인용 문제를 없앤다.
      const fake = '@([pscustomobject]@{ ProcessId = 101; CommandLine = $env:FAKE_A }, ' +
        '[pscustomobject]@{ ProcessId = 102; CommandLine = $env:FAKE_B }, ' +
        '[pscustomobject]@{ ProcessId = 103; CommandLine = $null })';
      const script = args[2].replace('Get-WmiObject Win32_Process', fake);
      expect(script).not.toBe(args[2]);
      const out = execFileSync(shell, [...args.slice(0, 2), script], {
        cwd,
        encoding: 'utf8',
        env: { ...env, FAKE_A: `node ${SMART_QUOTE_PAYLOAD.toUpperCase()} --stdio`, FAKE_B: 'node other.js' },
      });
      expect(out.trim().split(/\r?\n/)).toEqual(['101']);
      expect(fs.existsSync(path.join(cwd, 'pwned'))).toBe(false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
