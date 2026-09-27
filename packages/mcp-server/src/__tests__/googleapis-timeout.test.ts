import { describe, expect, it, vi } from 'vitest';
import { google } from '../lib/googleapis-lite.js';
import {
  GOOGLEAPIS_DEFAULT_OPTIONS,
  GOOGLEAPIS_MEDIA_TIMEOUT_MS,
  GOOGLEAPIS_TIMEOUT_MS,
  mediaUploadOptions,
  mediaUploadTimeoutMs,
} from '../lib/google-timeouts.js';
import { HTTP_TIMEOUT_MS } from '../lib/http.js';

/**
 * googleapis(gaxios) 경로의 타임아웃 (2026-09 점검).
 *
 * raw fetch 에는 http-timeout.test.ts 가드가 있었지만, 서버 호출의 대부분을 차지하는
 * googleapis 경로는 기본 타임아웃이 없어 응답 없는 소켓 하나가 stdio 도구 호출을 영원히
 * 붙잡을 수 있었다. 설정값만 보지 않고 **실제 요청 옵션까지** 흘러가는지 확인한다 —
 * googleapis-common 이 `context.google._options` 를 읽는 규약이 바뀌면 여기서 드러난다.
 */

describe('googleapis 기본 타임아웃', () => {
  it('유한한 상한이 걸려 있다', () => {
    expect(GOOGLEAPIS_TIMEOUT_MS).toBe(HTTP_TIMEOUT_MS);
    expect(GOOGLEAPIS_DEFAULT_OPTIONS.timeout).toBeGreaterThan(0);
    expect(google._options).toBe(GOOGLEAPIS_DEFAULT_OPTIONS);
    expect(GOOGLEAPIS_MEDIA_TIMEOUT_MS).toBeGreaterThan(GOOGLEAPIS_TIMEOUT_MS);
  });

  // 회귀 리뷰: main 에는 업로드 상한이 없었다 — 30분 상한은 느린 회선의 큰 영상을 끊었다.
  it('미디어 업로드 기본 상한은 3시간이고 MIMI_SEED_UPLOAD_TIMEOUT_MS 로 바꿀 수 있다', () => {
    expect(GOOGLEAPIS_MEDIA_TIMEOUT_MS).toBe(3 * 60 * 60_000);
    expect(mediaUploadTimeoutMs({})).toBe(GOOGLEAPIS_MEDIA_TIMEOUT_MS);
    expect(mediaUploadTimeoutMs({ MIMI_SEED_UPLOAD_TIMEOUT_MS: '21600000' })).toBe(21_600_000);
    for (const bad of ['', '0', '-5', 'abc', '1e9', '1.5']) {
      expect(mediaUploadTimeoutMs({ MIMI_SEED_UPLOAD_TIMEOUT_MS: bad }), bad).toBe(GOOGLEAPIS_MEDIA_TIMEOUT_MS);
    }
    vi.stubEnv('MIMI_SEED_UPLOAD_TIMEOUT_MS', '12345');
    try {
      expect(mediaUploadOptions()).toEqual({ timeout: 12_345 });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('재시도 횟수가 제한돼 있다 (타임아웃 × 재시도로 대기가 부풀지 않게)', () => {
    expect(GOOGLEAPIS_DEFAULT_OPTIONS.retryConfig.retry).toBeLessThanOrEqual(3);
    expect(GOOGLEAPIS_DEFAULT_OPTIONS.retryConfig.noResponseRetries).toBeLessThanOrEqual(1);
  });

  // 첫 호출이 iam 서브패스(googleapis 공통 런타임)를 동기 로드한다 — 콜드 캐시에서 수 초.
  it('실제 API 호출의 요청 옵션에 타임아웃이 실린다', { timeout: 60_000 }, async () => {
    let captured: Record<string, unknown> | undefined;
    const auth = {
      request: async (opts: Record<string, unknown>) => {
        captured = opts;
        return { data: {}, headers: new Headers(), status: 200, statusText: 'OK', config: opts };
      },
    };

    await google.iam('v1').projects.serviceAccounts.list({
      name: 'projects/example-project',
      auth: auth as never,
    });

    expect(captured?.timeout).toBe(GOOGLEAPIS_TIMEOUT_MS);
    expect(captured?.retryConfig).toMatchObject({ retry: 2, noResponseRetries: 1 });
  });

  it('호출별 옵션(미디어 업로드)이 기본값을 덮는다', async () => {
    let captured: Record<string, unknown> | undefined;
    const auth = {
      request: async (opts: Record<string, unknown>) => {
        captured = opts;
        return { data: {}, headers: new Headers(), status: 200, statusText: 'OK', config: opts };
      },
    };

    await google.iam('v1').projects.serviceAccounts.list(
      { name: 'projects/example-project', auth: auth as never },
      { timeout: GOOGLEAPIS_MEDIA_TIMEOUT_MS },
    );

    expect(captured?.timeout).toBe(GOOGLEAPIS_MEDIA_TIMEOUT_MS);
  });
});
