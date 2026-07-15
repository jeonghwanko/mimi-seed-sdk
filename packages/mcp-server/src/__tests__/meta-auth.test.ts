import { describe, expect, it } from 'vitest';
import { metaApiError, metaTokenFreshness, redactMetaSecrets } from '../lib/meta-auth.js';

describe('Meta auth recovery', () => {
  it('저장된 만료 시각을 fresh / expiring / expired 로 분류한다', () => {
    const now = Date.parse('2026-07-15T00:00:00Z');
    expect(metaTokenFreshness(undefined, now)).toEqual({ state: 'unknown' });
    expect(metaTokenFreshness('2026-07-14T00:00:00Z', now)).toEqual({
      state: 'expired',
      daysRemaining: 0,
    });
    expect(metaTokenFreshness('2026-07-18T00:00:00Z', now)).toEqual({
      state: 'expiring',
      daysRemaining: 3,
    });
    expect(metaTokenFreshness('2026-08-15T00:00:00Z', now)).toEqual({
      state: 'fresh',
      daysRemaining: 31,
    });
  });

  it('Meta code 190을 플랫폼별 재연결 명령으로 바꾼다', () => {
    const error = metaApiError(
      'instagram',
      400,
      'Error validating access token: Session has expired. (code 190)',
      190,
    );
    expect(error.message).toContain('mimi-seed auth instagram');
    expect(error.message).toContain('만료되었거나 취소');
  });

  it('오류 메시지에서 Meta 토큰을 가린다', () => {
    expect(redactMetaSecrets('access_token=IGAA_PLACEHOLDER_LONG_TOKEN&x=1')).toBe(
      'access_token=[REDACTED]&x=1',
    );
    expect(redactMetaSecrets('{"access_token":"THQVJ_LONG_THREADS_TOKEN"}')).toBe(
      '{"access_token":"[REDACTED]"}',
    );
    expect(redactMetaSecrets('Authorization: Bearer IGAA_LONG_TOKEN')).toContain(
      'Bearer [REDACTED]',
    );
  });
});
