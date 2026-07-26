import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithTimeout, HTTP_TIMEOUT_MS, HTTP_TRANSFER_TIMEOUT_MS } from '../lib/http.js';

const srcRoot = fileURLToPath(new URL('../', import.meta.url));

afterEach(() => vi.unstubAllGlobals());

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

    await expect(fetchWithTimeout('https://example.test/a', {}, 1_000)).rejects.toThrow(
      /example\.test\/a 요청이 1초 안에 끝나지 않아/,
    );
    await expect(fetchWithTimeout('https://example.test/a', {}, 1_000)).rejects.toMatchObject({
      cause: timeoutError,
    });
  });

  it('undici 가 cause 로 한 겹 감싼 타임아웃도 인식한다', async () => {
    const wrapped = Object.assign(new TypeError('fetch failed'), {
      cause: new DOMException('timed out', 'TimeoutError'),
    });
    vi.stubGlobal('fetch', vi.fn(async () => { throw wrapped; }));

    await expect(fetchWithTimeout('https://example.test/a')).rejects.toThrow(/안에 끝나지 않아/);
  });

  it('타임아웃이 아닌 에러는 그대로 통과시킨다', async () => {
    const boom = new Error('ECONNREFUSED');
    vi.stubGlobal('fetch', vi.fn(async () => { throw boom; }));

    await expect(fetchWithTimeout('https://example.test/a')).rejects.toBe(boom);
  });

  // Meta Graph API 는 ?access_token=... 로 토큰을 싣는다. 에러에 URL 을 통째로 넣으면
  // 그 토큰이 에이전트 전사록과 로그에 남는다.
  it('에러 메시지에 쿼리스트링(토큰)을 넣지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('t', 'TimeoutError');
    }));

    await expect(
      fetchWithTimeout('https://graph.facebook.com/v21.0/me?access_token=SECRET-TOKEN-VALUE'),
    ).rejects.toThrow(/^(?!.*SECRET-TOKEN-VALUE).*$/s);
  });

  it('상한값이 뒤집히지 않았다 (전송용 > 기본값)', () => {
    expect(HTTP_TRANSFER_TIMEOUT_MS).toBeGreaterThan(HTTP_TIMEOUT_MS);
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
