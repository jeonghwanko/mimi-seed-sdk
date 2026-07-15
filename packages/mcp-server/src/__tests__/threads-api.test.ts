import { afterEach, describe, expect, it, vi } from 'vitest';
import { postCarousel, refreshAccessToken } from '../threads/api.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Threads API', () => {
  it('long-lived 토큰을 공식 refresh endpoint로 갱신한다', async () => {
    const fetchMock = vi.fn(async () => json({
      access_token: 'THQVJ_REFRESHED_TOKEN',
      expires_in: 5_184_000,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshAccessToken('THQVJ_CURRENT_TOKEN')).resolves.toEqual({
      accessToken: 'THQVJ_REFRESHED_TOKEN',
      expiresInSeconds: 5_184_000,
    });

    const requested = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${requested.origin}${requested.pathname}`).toBe(
      'https://graph.threads.net/refresh_access_token',
    );
    expect(requested.searchParams.get('grant_type')).toBe('th_refresh_token');
  });

  it('캐러셀 부모 컨테이너까지 FINISHED를 확인한 뒤 게시한다', async () => {
    const responses = [
      { id: 'child-1' },
      { id: 'child-2' },
      { id: 'child-1', status: 'FINISHED' },
      { id: 'child-2', status: 'FINISHED' },
      { id: 'carousel-1' },
      { id: 'carousel-1', status: 'FINISHED' },
      { id: 'published-1' },
      { permalink: 'https://www.threads.net/@example/post/1' },
    ];
    const fetchMock = vi.fn(async () => json(responses.shift()));
    vi.stubGlobal('fetch', fetchMock);

    await expect(postCarousel(
      { accessToken: 'THQVJ_TOKEN', userId: 'user-1' },
      ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
      'caption',
    )).resolves.toEqual({
      id: 'published-1',
      permalink: 'https://www.threads.net/@example/post/1',
    });

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      url: String(input),
      method: (init as RequestInit | undefined)?.method ?? 'GET',
    }));
    const parentStatusIndex = calls.findIndex(({ url, method }) =>
      method === 'GET' && url.includes('/carousel-1?'));
    const publishIndex = calls.findIndex(({ url }) => url.includes('/user-1/threads_publish'));
    expect(parentStatusIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(parentStatusIndex);
  });
});
