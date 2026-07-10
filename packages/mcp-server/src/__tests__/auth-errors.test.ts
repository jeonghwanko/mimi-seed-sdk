import { describe, it, expect } from 'vitest';
import { classifyError } from '../auth/errors.js';

describe('classifyError — CONFIG_FETCH_FAILED (mcp-auth-config 마커)', () => {
  it('마커가 있으면 네트워크 에러보다 먼저 CONFIG_FETCH_FAILED 로 분류', () => {
    // fetch 실패 메시지에 ECONNREFUSED 가 섞여 있어도 마커가 이긴다 —
    // 아니면 "oauth2.googleapis.com 연결 실패" 로 엉뚱한 호스트를 지목한다.
    const p = classifyError(
      new Error('mcp-auth-config fetch failed (https://mimi-seed.pryzm.gg 접속 불가: ECONNREFUSED)'),
      { phase: 'refresh' },
    );
    expect(p.code).toBe('CONFIG_FETCH_FAILED');
    expect(p.hint).toContain('MIMI_SEED_GOOGLE_CLIENT_ID');
    expect(p.needsReauth).toBe(false);
  });

  it('HTTP 상태/빈 응답/비JSON 변형도 모두 같은 코드로', () => {
    for (const msg of [
      'mcp-auth-config fetch failed (500)',
      'mcp-auth-config fetch failed (서버 응답에 clientId/clientSecret 비어 있음)',
      "mcp-auth-config fetch failed (응답이 JSON 이 아님: Unexpected token '<')",
    ]) {
      expect(classifyError(new Error(msg), { phase: 'refresh' }).code).toBe('CONFIG_FETCH_FAILED');
    }
  });
});

describe('classifyError — access_denied (미검증 앱 안내)', () => {
  it('테스트 사용자 등록 안내를 포함한다 (무한 재시도 루프 방지)', () => {
    const p = classifyError(new Error('access_denied'), { phase: 'login' });
    expect(p.code).toBe('USER_DENIED');
    expect(p.hint).toContain('테스트 사용자');
  });
});
