import { describe, it, expect } from 'vitest';
import { friendlyAppStoreError, __testing } from '../appstore/errors.js';

describe('friendlyAppStoreError', () => {
  it('Apple 표준 JSON 에러 파싱 + INVALID_CHARACTERS hint', () => {
    const body = JSON.stringify({
      errors: [
        {
          code: 'INVALID_CHARACTERS',
          title: 'An attribute value contains invalid characters.',
          detail: "Attribute 'whatsNew' contains invalid characters.",
          source: { pointer: '/data/attributes/whatsNew' },
        },
      ],
    });
    const err = friendlyAppStoreError(409, body);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('App Store API 409');
    expect(err.message).toContain('[INVALID_CHARACTERS]');
    expect(err.message).toContain('/data/attributes/whatsNew');
    expect(err.message).toContain('text-validators');
  });

  it('ENTITY_STATE_INVALID hint', () => {
    const body = JSON.stringify({
      errors: [{ code: 'ENTITY_STATE_INVALID', detail: 'Cannot edit in current state.' }],
    });
    const err = friendlyAppStoreError(409, body);
    expect(err.message).toContain('[ENTITY_STATE_INVALID]');
    expect(err.message).toContain('편집 가능 단계가 아니');
  });

  it('알려지지 않은 code 는 hint 없이 detail 만', () => {
    const body = JSON.stringify({
      errors: [{ code: 'TOTALLY_NEW_CODE', detail: 'Some new error.' }],
    });
    const err = friendlyAppStoreError(500, body);
    expect(err.message).toContain('[TOTALLY_NEW_CODE]');
    expect(err.message).toContain('Some new error.');
    expect(err.message).not.toContain('💡');
  });

  it('여러 errors 줄바꿈으로 결합', () => {
    const body = JSON.stringify({
      errors: [
        { code: 'INVALID_CHARACTERS', detail: 'first' },
        { code: 'ENTITY_STATE_INVALID', detail: 'second' },
      ],
    });
    const err = friendlyAppStoreError(409, body);
    expect(err.message.split('\n').length).toBeGreaterThanOrEqual(3);
  });

  it('비표준 body (HTML) 폴백 — 원본 message 보존', () => {
    const body = '<html><body>500 Internal Server Error</body></html>';
    const err = friendlyAppStoreError(500, body);
    expect(err.message).toBe('App Store API 500: <html><body>500 Internal Server Error</body></html>');
  });

  it('빈 body 폴백', () => {
    const err = friendlyAppStoreError(502, '');
    expect(err.message).toBe('App Store API 502: ');
  });

  it('errors 배열이 비어있으면 폴백', () => {
    const body = JSON.stringify({ errors: [] });
    const err = friendlyAppStoreError(409, body);
    // Apple JSON 이지만 errors 가 비어 있으면 의미 있는 friendlyfmt 불가 → 폴백
    expect(err.message).toBe(`App Store API 409: ${body}`);
  });

  it('Error.cause 에 원본 + parsedErrors 보존', () => {
    const body = JSON.stringify({
      errors: [{ code: 'INVALID_CHARACTERS', detail: 'x' }],
    });
    const err = friendlyAppStoreError(409, body) as Error & { cause?: { status: number; body: string; parsedErrors?: unknown[] } };
    expect(err.cause).toBeDefined();
    expect(err.cause?.status).toBe(409);
    expect(err.cause?.body).toBe(body);
    expect(err.cause?.parsedErrors).toHaveLength(1);
  });

  it('비표준 body 의 cause.parsedErrors 는 undefined', () => {
    const err = friendlyAppStoreError(500, 'plain text') as Error & { cause?: { parsedErrors?: unknown[] } };
    expect(err.cause?.parsedErrors).toBeUndefined();
  });

  it('isNotFoundError 호환 — App Store API 404: prefix 유지', () => {
    // tools.ts:255 의 isNotFoundError 가 /^App Store API 404:/.test() 로 분기.
    // friendly 변환 후에도 prefix 매칭되어야 호환.
    const body = JSON.stringify({ errors: [{ code: 'NOT_FOUND', detail: 'not found' }] });
    const err = friendlyAppStoreError(404, body);
    expect(/^App Store API 404:/.test(err.message)).toBe(true);

    // 폴백 케이스도 마찬가지
    const err2 = friendlyAppStoreError(404, 'plain');
    expect(/^App Store API 404:/.test(err2.message)).toBe(true);
  });
});

describe('__testing.parseAppleErrorBody', () => {
  it('정상 JSON 파싱', () => {
    const parsed = __testing.parseAppleErrorBody(
      JSON.stringify({ errors: [{ code: 'X' }] }),
    );
    expect(parsed).toHaveLength(1);
  });

  it('JSON 아닌 입력은 null', () => {
    expect(__testing.parseAppleErrorBody('not json')).toBe(null);
  });

  it('빈 입력은 null', () => {
    expect(__testing.parseAppleErrorBody('')).toBe(null);
  });

  it('errors 키 없는 JSON 은 null', () => {
    expect(__testing.parseAppleErrorBody('{"foo":"bar"}')).toBe(null);
  });
});

// 2026-07-21 실측: Apple 이 실제로 보내는 코드는 점 표기다. 오래 쓰던 언더스코어
// 키(ENTITY_ERROR_ATTRIBUTE_INVALID 등)는 한 번도 매칭되지 않는 죽은 코드였다.
describe('점 표기 에러 코드 hint (실측 응답 기반)', () => {
  it('길이 초과 코드에 hint 가 붙고 Apple 이 알려준 상한이 그대로 보인다', () => {
    const err = friendlyAppStoreError(409, JSON.stringify({
      errors: [{
        code: 'ENTITY_ERROR.ATTRIBUTE.INVALID.TOO_LONG',
        title: 'The provided entity contains a field whose value is too long',
        detail: 'The field (DESCRIPTION) is too long. Max number of characters is (55).',
      }],
    }));
    expect(err.message).toContain('Max number of characters is (55)');
    expect(err.message).toContain('💡');
  });

  it('심사 중 잠김(UNMODIFIABLE)은 무엇을 해야 하는지 알려준다', () => {
    const err = friendlyAppStoreError(409, JSON.stringify({
      errors: [{
        code: 'ENTITY_ERROR.ATTRIBUTE.INVALID.UNMODIFIABLE',
        detail: 'The field (NAME) can not be modified',
      }],
    }));
    expect(err.message).toContain('심사 중');
    expect(err.message).toContain('cancel_review');
  });

  it('모르는 하위 코드는 상위 코드 hint 로 폴백한다', () => {
    const err = friendlyAppStoreError(409, JSON.stringify({
      errors: [{ code: 'ENTITY_ERROR.ATTRIBUTE.INVALID.SOMETHING_NEW', detail: 'nope' }],
    }));
    expect(err.message).toContain('💡');
  });

  it('아무 데도 안 걸리는 코드는 hint 없이 detail 만 낸다', () => {
    const err = friendlyAppStoreError(409, JSON.stringify({
      errors: [{ code: 'TOTALLY_UNKNOWN', detail: 'nope' }],
    }));
    expect(err.message).toContain('nope');
    expect(err.message).not.toContain('💡');
  });
});
