import { describe, expect, it } from 'vitest';
import { friendlyAdmobError } from '../admob/errors.js';

// 실사고: 토큰·admob 스코프가 정상인데 로그인 계정이 AdMob 사용자가 아니면 AdMob 은
// "missing required authentication credential" 401 을 준다 — 토큰 누락처럼 읽혀 SDK 버그로 오진됐다.
function gaxios(status: number, message: string, reason?: string) {
  return Object.assign(new Error(message), {
    status,
    response: { status, data: { error: { message, errors: reason ? [{ reason, message }] : [] } } },
  });
}

describe('friendlyAdmobError', () => {
  it('401 은 로그인 계정을 이름으로 보여 주고 AdMob 계정으로 재로그인하라고 안내한다', () => {
    const raw = gaxios(401, 'Request is missing required authentication credential.');
    const err = friendlyAdmobError(raw, 'someone@example.com');
    expect(err.message).toContain('someone@example.com');
    expect(err.message).toContain('mimi_seed_auth_start(domains=["admob"])');
    expect(err.message).not.toContain('missing required authentication credential');
    expect((err as Error & { cause?: unknown }).cause).toBe(raw);
  });

  it('계정을 모르면 일반 문구로 안내한다', () => {
    const err = friendlyAdmobError(gaxios(401, 'UNAUTHENTICATED'), null);
    expect(err.message).toContain('현재 로그인한 Google 계정');
  });

  it('403 은 Google 사유를 보존한다', () => {
    const err = friendlyAdmobError(gaxios(403, 'The caller does not have permission', 'PERMISSION_DENIED'), 'someone@example.com');
    expect(err.message).toContain('403');
    expect(err.message).toContain('The caller does not have permission');
  });

  it('스코프 부족은 계정 문제로 오진하지 않고 재로그인 안내로 보낸다', () => {
    const err = friendlyAdmobError(gaxios(403, 'Request had insufficient authentication scopes. ACCESS_TOKEN_SCOPE_INSUFFICIENT'), 'someone@example.com');
    expect(err.message).toContain('권한이 부족');
    expect(err.message).not.toContain('someone@example.com');
  });

  it('인식 못 한 에러는 원본 그대로', () => {
    const raw = gaxios(500, 'backend error');
    expect(friendlyAdmobError(raw, 'someone@example.com')).toBe(raw);
  });
});
