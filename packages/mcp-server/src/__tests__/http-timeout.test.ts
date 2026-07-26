import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchWithTimeout,
  parseRetryAfter,
  HTTP_TIMEOUT_MS,
  HTTP_TRANSFER_TIMEOUT_MS,
  HTTP_MAX_ATTEMPTS,
} from '../lib/http.js';

const srcRoot = fileURLToPath(new URL('../', import.meta.url));

afterEach(() => vi.unstubAllGlobals());

// 이 블록은 **에러 번역**만 본다. 재시도까지 돌면 관심사와 무관한 백오프를 실제로
// 기다리게 되므로 maxAttempts: 1 로 격리한다 (재시도 자체는 아래 블록에서 검증).
describe('fetchWithTimeout', () => {
  it('signal 을 안 주면 타임아웃 signal 을 붙여 넘긴다 (인자는 정확히 2개)', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);

    await fetchWithTimeout('https://example.test/a', { method: 'POST' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(fetchMock.mock.calls[0]).toHaveLength(2);
    expect(input).toBe('https://example.test/a');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('호출부가 넘긴 signal 은 덮어쓰지 않는다', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await fetchWithTimeout('https://example.test/a', { signal: controller.signal });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it('타임아웃은 조치 가능한 메시지로 번역하고 원인을 cause 에 보존한다', async () => {
    const timeoutError = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    vi.stubGlobal('fetch', vi.fn(async () => { throw timeoutError; }));

    const once = { timeoutMs: 1_000, maxAttempts: 1 };
    await expect(fetchWithTimeout('https://example.test/a', {}, once)).rejects.toThrow(
      /example\.test\/a 요청이 1초 안에 끝나지 않아/,
    );
    await expect(fetchWithTimeout('https://example.test/a', {}, once)).rejects.toMatchObject({
      cause: timeoutError,
    });
  });

  it('undici 가 cause 로 한 겹 감싼 타임아웃도 인식한다', async () => {
    const wrapped = Object.assign(new TypeError('fetch failed'), {
      cause: new DOMException('timed out', 'TimeoutError'),
    });
    vi.stubGlobal('fetch', vi.fn(async () => { throw wrapped; }));

    await expect(fetchWithTimeout('https://example.test/a', {}, { maxAttempts: 1 })).rejects.toThrow(
      /안에 끝나지 않아/,
    );
  });

  it('타임아웃이 아닌 에러는 그대로 통과시킨다', async () => {
    const boom = new Error('ECONNREFUSED');
    vi.stubGlobal('fetch', vi.fn(async () => { throw boom; }));

    await expect(fetchWithTimeout('https://example.test/a', {}, { maxAttempts: 1 })).rejects.toBe(boom);
  });

  // Meta Graph API 는 ?access_token=... 로 토큰을 싣는다. 에러에 URL 을 통째로 넣으면
  // 그 토큰이 에이전트 전사록과 로그에 남는다.
  it('에러 메시지에 쿼리스트링(토큰)을 넣지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('t', 'TimeoutError');
    }));

    await expect(
      fetchWithTimeout('https://graph.facebook.com/v21.0/me?access_token=SECRET-TOKEN-VALUE', {}, {
        maxAttempts: 1,
      }),
    ).rejects.toThrow(/^(?!.*SECRET-TOKEN-VALUE).*$/s);
  });

  it('상한값이 뒤집히지 않았다 (전송용 > 기본값)', () => {
    expect(HTTP_TRANSFER_TIMEOUT_MS).toBeGreaterThan(HTTP_TIMEOUT_MS);
  });
});

/**
 * 재시도 정책. 여기서 분기를 잘못 타면 **POST 가 두 번 나가** 스토어에 버전/제품/심사
 * 제출이 중복 생성된다 — 한 번 실패하는 것보다 훨씬 나쁜 결과다.
 */
describe('fetchWithTimeout 재시도', () => {
  const res = (status: number, headers: Record<string, string> = {}) =>
    new Response(status === 204 ? null : 'body', { status, headers });

  // 백오프를 실제로 기다리면 이 파일 하나가 14초를 먹는다. 타이머만 가짜로 돌린다.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** 대기 중인 백오프를 즉시 소진하고 결과를 돌려준다. */
  async function settle<T>(promise: Promise<T>): Promise<T> {
    const guarded = promise.then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e }),
    );
    await vi.runAllTimersAsync();
    const r = await guarded;
    if (r.ok) return r.v;
    throw r.e;
  }

  it('429 는 POST 라도 재시도한다 (레이트 리미터는 처리 전에 거절한다)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(res(200));
    vi.stubGlobal('fetch', fetchMock);

    const r = await settle(fetchWithTimeout('https://example.test/a', { method: 'POST', body: '{}' }));

    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('5xx 는 POST 에서 재시도하지 않는다 (서버가 이미 처리했을 수 있다)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(503));
    vi.stubGlobal('fetch', fetchMock);

    const r = await settle(fetchWithTimeout('https://example.test/a', { method: 'POST', body: '{}' }));

    expect(r.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('5xx 는 PUT(=청크 업로드)에서는 재시도한다', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res(502)).mockResolvedValueOnce(res(200));
    vi.stubGlobal('fetch', fetchMock);

    const r = await settle(
      fetchWithTimeout('https://example.test/chunk', { method: 'PUT', body: new Uint8Array([1, 2, 3]) }),
    );

    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('GET 네트워크 오류는 재시도하고, 끝내 실패하면 마지막 오류를 던진다', async () => {
    const boom = new Error('ECONNRESET');
    const fetchMock = vi.fn().mockRejectedValue(boom);
    vi.stubGlobal('fetch', fetchMock);

    await expect(settle(fetchWithTimeout('https://example.test/a'))).rejects.toBe(boom);
    expect(fetchMock).toHaveBeenCalledTimes(HTTP_MAX_ATTEMPTS);
  });

  it('POST 네트워크 오류는 재시도하지 않는다', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      settle(fetchWithTimeout('https://example.test/a', { method: 'POST', body: '{}' })),
    ).rejects.toThrow('ECONNRESET');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('4xx(429 제외)는 재시도하지 않고 그대로 돌려준다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(403));
    vi.stubGlobal('fetch', fetchMock);

    const r = await settle(fetchWithTimeout('https://example.test/a'));

    expect(r.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('스트림 본문은 재전송하면 빈 요청이 되므로 재시도하지 않는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(429, { 'retry-after': '0' }));
    vi.stubGlobal('fetch', fetchMock);

    const body = new ReadableStream();
    const r = await settle(fetchWithTimeout('https://example.test/a', { method: 'PUT', body }));

    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('호출부가 signal 을 넘기면 재시도하지 않는다 (취소 주체는 하나여야 한다)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(429, { 'retry-after': '0' }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await settle(fetchWithTimeout('https://example.test/a', { signal: new AbortController().signal }));

    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maxAttempts 를 넘길 때까지 재시도하고 마지막 응답을 돌려준다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(429, { 'retry-after': '0' }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await settle(fetchWithTimeout('https://example.test/a', {}, { maxAttempts: 2 }));

    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('세 번째 인자로 숫자를 주면 timeoutMs 로 해석한다 (기존 호출부 호환)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('t', 'TimeoutError'); }));
    await expect(settle(fetchWithTimeout('https://example.test/a', {}, 1_000))).rejects.toThrow(/1초 안에/);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-07-26T12:00:00Z');

  it('초 단위 숫자를 밀리초로 바꾼다', () => {
    expect(parseRetryAfter('3', now)).toBe(3_000);
  });

  it('HTTP-date 를 남은 시간으로 바꾼다', () => {
    expect(parseRetryAfter('Sun, 26 Jul 2026 12:00:05 GMT', now)).toBe(5_000);
  });

  it('이미 지난 시각은 0', () => {
    expect(parseRetryAfter('Sun, 26 Jul 2026 11:59:00 GMT', now)).toBe(0);
  });

  it('상한을 넘는 값은 잘라낸다 (도구 호출이 매달린 것과 같아진다)', () => {
    expect(parseRetryAfter('99999', now)).toBeLessThanOrEqual(20_000);
  });

  it('해석 불가/부재는 null (호출부가 지수 백오프로 폴백)', () => {
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });
});

/**
 * 이 가드가 없으면 다음에 provider 클라이언트를 추가하는 사람이 raw `fetch` 를 쓰고,
 * "stdio 도구 호출이 무한 대기" 결함이 조용히 되돌아온다. 타임아웃은 호출부마다
 * 기억해야 하는 규칙이 아니라 기본값이어야 한다.
 */
describe('raw fetch 금지 가드', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        return entry === '__tests__' ? [] : sourceFiles(full);
      }
      return full.endsWith('.ts') ? [full] : [];
    });
  }

  it('lib/http.ts 를 빼면 src 어디에도 raw fetch( 호출이 없다', () => {
    const files = sourceFiles(srcRoot);
    // 스캔이 0건이면 이 가드는 "위반 없음"이 아니라 "아무것도 안 봤음"이다.
    expect(files.length, '소스 스캔이 비었다 — 가드가 무력화됐다').toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const file of files) {
      if (file === path.join(srcRoot, 'lib', 'http.ts')) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // fetchWithTimeout / fetchJson / prefetch 같은 식별자는 걸리지 않게 경계를 본다.
          if (/(^|[^.\w])fetch\s*\(/.test(line)) {
            offenders.push(`${path.relative(srcRoot, file)}:${i + 1}`);
          }
        });
    }

    expect(
      offenders,
      `raw fetch( 사용 — lib/http.ts 의 fetchWithTimeout 을 쓰세요: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
