import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithTimeout, HTTP_STREAM_TIMEOUT_MS, HTTP_TIMEOUT_MS } from '../lib/http.js';
import { jenkinsBase } from '../jenkins-project.js';

// CLI 판 http-timeout 가드. mcp-server 의 같은 이름 테스트와 같은 규칙을 이 패키지에 건다 —
// 두 패키지는 서로를 import 하지 않으므로 가드도 각자 있어야 한다.

const srcRoot = fileURLToPath(new URL('../', import.meta.url));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('fetchWithTimeout (CLI)', () => {
  it('signal 을 안 주면 타임아웃 signal 을 붙여 넘긴다', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);

    await fetchWithTimeout('https://example.test/a', { method: 'POST' });

    const [input, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
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

  it('타임아웃은 조치 가능한 메시지로 바꾸고, 원인은 cause 에 남기고, 쿼리스트링(토큰)은 버린다', async () => {
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    const timeoutError = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    vi.stubGlobal('fetch', vi.fn(async () => { throw timeoutError; }));

    const call = fetchWithTimeout('https://ci.example.test/api/v4/user?private_token=SECRET-VALUE', {}, 2_000);
    await expect(call).rejects.toThrow(/ci\.example\.test\/api\/v4\/user did not finish within 2s/);
    await expect(
      fetchWithTimeout('https://ci.example.test/api/v4/user?private_token=SECRET-VALUE', {}, 2_000),
    ).rejects.toMatchObject({ cause: timeoutError });
    await expect(
      fetchWithTimeout('https://ci.example.test/api/v4/user?private_token=SECRET-VALUE', {}, 2_000),
    ).rejects.toThrow(/^(?!.*SECRET-VALUE).*$/s);
  });

  it('undici 가 cause 로 감싼 타임아웃도 알아본다', async () => {
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    const wrapped = Object.assign(new TypeError('fetch failed'), {
      cause: new DOMException('timed out', 'TimeoutError'),
    });
    vi.stubGlobal('fetch', vi.fn(async () => { throw wrapped; }));

    await expect(fetchWithTimeout('https://example.test/a')).rejects.toThrow(/did not finish within/);
  });

  it('타임아웃이 아닌 에러는 그대로 통과시킨다', async () => {
    const boom = new Error('ECONNREFUSED');
    vi.stubGlobal('fetch', vi.fn(async () => { throw boom; }));

    await expect(fetchWithTimeout('https://example.test/a')).rejects.toBe(boom);
  });

  it('스트리밍 상한이 기본 상한보다 길다 (SSE 가 파이프라인 도중에 잘리지 않게)', () => {
    expect(HTTP_STREAM_TIMEOUT_MS).toBeGreaterThan(HTTP_TIMEOUT_MS);
  });
});

describe('Jenkins base URL', () => {
  // 트리거만 끝 슬래시를 떼고 큐/상태 조회는 떼지 않아 `//queue/...` 가 404 나던 불일치.
  it('끝 슬래시를 몇 개든 한 가지 규칙으로 뗀다', () => {
    expect(jenkinsBase('https://jenkins.example.com/')).toBe('https://jenkins.example.com');
    expect(jenkinsBase('https://jenkins.example.com//')).toBe('https://jenkins.example.com');
    expect(jenkinsBase(' https://jenkins.example.com/ci ')).toBe('https://jenkins.example.com/ci');
    expect(jenkinsBase('https://jenkins.example.com')).toBe('https://jenkins.example.com');
  });
});

/**
 * 다음 사람이 새 호출부에 raw `fetch` 를 쓰면 "CLI 가 응답 없는 서버 앞에서 영원히 멈춤" 이
 * 조용히 돌아온다. 타임아웃은 기본값이어야 한다.
 */
describe('raw fetch 금지 가드 (CLI)', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(full);
      return full.endsWith('.ts') ? [full] : [];
    });
  }

  it('lib/http.ts 를 빼면 src 어디에도 raw fetch( 호출이 없다', () => {
    const files = sourceFiles(srcRoot);
    // 스캔이 0건이면 이 가드는 "위반 없음"이 아니라 "아무것도 안 봤음"이다.
    expect(files.length, '소스 스캔이 비었다 — 가드가 무력화됐다').toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const file of files) {
      if (file === path.join(srcRoot, 'lib', 'http.ts')) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // fetchWithTimeout / prefetch 같은 식별자는 걸리지 않게 경계를 본다.
          if (/(^|[^.\w])fetch\s*\(/.test(line)) offenders.push(`${path.relative(srcRoot, file)}:${i + 1}`);
        });
    }

    expect(offenders, `raw fetch( 사용 — lib/http.ts 의 fetchWithTimeout 을 쓰세요: ${offenders.join(', ')}`).toEqual([]);
  });
});
