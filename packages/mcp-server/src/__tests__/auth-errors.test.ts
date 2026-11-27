import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { AuthError, authText, classifyError } from '../auth/errors.js';
import { callbackPortInUse } from '../auth/google-auth.js';

// 문구는 resolveLang() 을 따른다 — 개발자 머신의 로캘/settings.json 에 흔들리지 않게 기본은 ko 로 고정.
beforeEach(() => { vi.stubEnv('MIMI_SEED_LANG', 'ko'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('classifyError — CONFIG_FETCH_FAILED (mcp-auth-config 마커)', () => {
  it('마커가 있으면 네트워크 에러보다 먼저 CONFIG_FETCH_FAILED 로 분류', () => {
    // fetch 실패 메시지에 ECONNREFUSED 가 섞여 있어도 마커가 이긴다 —
    // 아니면 "oauth2.googleapis.com 연결 실패" 로 엉뚱한 호스트를 지목한다.
    const p = classifyError(
      new Error('mcp-auth-config fetch failed (https://console.example.test 접속 불가: ECONNREFUSED)'),
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

describe('classifyError — CONFIG_FETCH_FAILED 재시도 여부', () => {
  it('클라이언트가 설정되지 않은 경우는 재시도 불가, 콘솔 접속 실패는 재시도 가능', () => {
    const none = classifyError(new Error('mcp-auth-config not configured: set MIMI_SEED_GOOGLE_CLIENT_ID and MIMI_SEED_GOOGLE_CLIENT_SECRET'), { phase: 'login' });
    expect(none.code).toBe('CONFIG_FETCH_FAILED');
    expect(none.retriable).toBe(false);
    const network = classifyError(new Error('mcp-auth-config fetch failed (cannot reach https://console.example.test: ECONNRESET)'), { phase: 'login' });
    expect(network.retriable).toBe(true);
  });
});

describe('classifyError — access_denied (미검증 앱 안내)', () => {
  it('테스트 사용자 등록 안내를 포함한다 (무한 재시도 루프 방지)', () => {
    const p = classifyError(new Error('access_denied'), { phase: 'login' });
    expect(p.code).toBe('USER_DENIED');
    expect(p.hint).toContain('테스트 사용자');
  });
});

describe('인증 에러 문구 — 언어 선택', () => {
  // classifyError 의 모든 분기를 밟는 입력.
  const inputs: Array<[unknown, 'refresh' | 'login']> = [
    [new Error('invalid_grant'), 'refresh'],
    [new Error('invalid_rapt'), 'refresh'],
    [new Error('invalid_client'), 'refresh'],
    [new Error('unauthorized_client'), 'refresh'],
    [new Error('access_denied'), 'login'],
    [new Error('mcp-auth-config fetch failed (500)'), 'refresh'],
    [Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }), 'refresh'],
    [Object.assign(new Error('listen'), { code: 'EADDRINUSE' }), 'login'],
    [new Error('timeout waiting for callback'), 'login'],
    [new Error('something else'), 'refresh'],
    [new Error('something else'), 'login'],
  ];

  it('MIMI_SEED_LANG=en 이면 어떤 분기에서도 한글이 섞이지 않는다', () => {
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    const texts = inputs.flatMap(([e, phase]) => {
      const p = classifyError(e, { phase });
      return [p.message, p.hint ?? ''];
    });
    const T = authText();
    texts.push(
      ...Object.values(callbackPortInUse('::1', new Error('EADDRINUSE'))).filter((v) => typeof v === 'string'),
      T.unauthenticated.message, T.noRefreshToken.hint, T.tokenResponseInvalid.message,
      T.insufficientScope(['https://www.googleapis.com/auth/x']).message,
      T.reloginInTerminal, T.callbackPage.title, T.callbackPage.body,
    );
    for (const text of texts) expect(text).not.toMatch(/[가-힣]/);
  });

  it('분류 코드와 플래그는 언어와 무관하다', () => {
    const strip = ({ message: _m, hint: _h, ...rest }: ReturnType<typeof classifyError>) => rest;
    const koPayloads = inputs.map(([e, phase]) => strip(classifyError(e, { phase })));
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    const enPayloads = inputs.map(([e, phase]) => strip(classifyError(e, { phase })));
    expect(enPayloads).toEqual(koPayloads);
  });

  it('언어는 모듈 로드가 아니라 호출 시점에 읽는다', () => {
    const before = classifyError(new Error('invalid_grant'), { phase: 'refresh' }).message;
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    const after = classifyError(new Error('invalid_grant'), { phase: 'refresh' }).message;
    expect(before).toMatch(/[가-힣]/);
    expect(after).toContain('no longer valid');
  });
});

describe('classifyError — 이미 분류된 AuthError', () => {
  it.each(['ko', 'en'])('재분류하지 않고 원래 payload 를 돌려준다 (%s)', (lang) => {
    vi.stubEnv('MIMI_SEED_LANG', lang);
    const original = callbackPortInUse('127.0.0.1', new Error('listen EADDRINUSE'));
    expect(classifyError(new AuthError(original), { phase: 'login' })).toBe(original);
  });
});
