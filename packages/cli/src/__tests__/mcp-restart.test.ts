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
