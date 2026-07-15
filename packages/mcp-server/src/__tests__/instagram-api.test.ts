import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as api from '../instagram/api.js';
import { apiBaseFor } from '../instagram/api.js';
import type { InstagramConfig } from '../instagram/config.js';

const cfg: InstagramConfig = {
  accessToken: 'EAAtoken',
  userId: '17841400000000000',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResp(text: string, status = 400): Response {
  return new Response(text, { status });
}

// ── getAccount ──

describe('apiBaseFor — token prefix routing', () => {
  it('IGAA → graph.instagram.com', () => {
    expect(apiBaseFor('IGAAxxxxx')).toBe('https://graph.instagram.com/v21.0');
  });

  it('EAA → graph.facebook.com', () => {
    expect(apiBaseFor('EAAxxxxx')).toBe('https://graph.facebook.com/v21.0');
  });

  it('unknown prefix defaults to graph.facebook.com (back-compat)', () => {
    expect(apiBaseFor('xyzxyz')).toBe('https://graph.facebook.com/v21.0');
  });
});

describe('getAccount', () => {
  it('Facebook Login token uses graph.facebook.com', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ id: cfg.userId, username: 'mimi' }));
    await api.getAccount(cfg);

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(`https://graph.facebook.com/v21.0/${cfg.userId}`);
    expect(url.searchParams.get('access_token')).toBe(cfg.accessToken);
    expect(url.searchParams.get('fields')).toContain('username');
    expect(url.searchParams.get('fields')).toContain('followers_count');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });

  it('Instagram Login token (IGAA) uses graph.instagram.com', async () => {
    const igCfg = { accessToken: 'IGAA_test', userId: '17841999' };
    fetchMock.mockResolvedValueOnce(jsonResp({ id: igCfg.userId, username: 'mimi' }));
    await api.getAccount(igCfg);

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin).toBe('https://graph.instagram.com');
  });

  it('IGAA token requests minimal fields (no name/profile_picture_url)', async () => {
    const igCfg = { accessToken: 'IGAA_test', userId: '17841999' };
    fetchMock.mockResolvedValueOnce(jsonResp({ id: igCfg.userId, username: 'mimi' }));
    await api.getAccount(igCfg);

    // username은 OK, name은 별개 필드. comma split으로 정확 일치 비교
    const fields = (new URL(fetchMock.mock.calls[0][0]).searchParams.get('fields') ?? '').split(',');
    expect(fields).not.toContain('name');
    expect(fields).not.toContain('profile_picture_url');
    expect(fields).toContain('username');
  });

  it('parses Graph error format with code', async () => {
    fetchMock.mockResolvedValueOnce(
      textResp(JSON.stringify({
        error: { message: 'Invalid OAuth access token', code: 190, type: 'OAuthException' },
      }), 400),
    );
    await expect(api.getAccount(cfg)).rejects.toThrow(/Invalid OAuth access token.*code 190/);
  });

  it('falls back to raw text when error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(textResp('Service Unavailable', 503));
    await expect(api.getAccount(cfg)).rejects.toThrow(/503.*Service Unavailable/);
  });
});

// ── fetchUserId ──

describe('fetchUserId', () => {
  it('IGAA token: GET /me returns user_id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ user_id: '17841555', username: 'cafe' }));
    const id = await api.fetchUserId('IGAA_xxx');
    expect(id).toBe('17841555');
    expect(String(fetchMock.mock.calls[0][0])).toContain('https://graph.instagram.com');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/me');
  });

  it('IGAA token: falls back to id when user_id absent', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ id: '17841666', username: 'cafe' }));
    const id = await api.fetchUserId('IGAA_xxx');
    expect(id).toBe('17841666');
  });

  it('EAA token: GET /me/accounts → instagram_business_account.id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResp({
        data: [
          { instagram_business_account: { id: '17841777' } },
        ],
      }),
    );
    const id = await api.fetchUserId('EAA_xxx');
    expect(id).toBe('17841777');
    expect(String(fetchMock.mock.calls[0][0])).toContain('graph.facebook.com');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/me/accounts');
  });

  it('EAA token: throws helpful error when no IG Business Account linked', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ data: [{}] })); // no instagram_business_account
    await expect(api.fetchUserId('EAA_xxx')).rejects.toThrow(/Instagram Business Account/);
  });

  it('EAA token: throws when no pages at all', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ data: [] }));
    await expect(api.fetchUserId('EAA_xxx')).rejects.toThrow(/Instagram Business Account/);
  });
});

// ── postImage ──

describe('postImage', () => {
  it('runs 2-step flow: container → publish → permalink', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResp({ id: 'CONTAINER_123' }))   // create container
      .mockResolvedValueOnce(jsonResp({ id: 'MEDIA_456' }))         // publish
      .mockResolvedValueOnce(jsonResp({ permalink: 'https://www.instagram.com/p/abc/' })); // permalink

    const result = await api.postImage(cfg, 'https://cdn.example.com/img.jpg', 'hello');

    expect(result).toEqual({ id: 'MEDIA_456', permalink: 'https://www.instagram.com/p/abc/' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('container request uses POST with form-urlencoded body', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResp({ id: 'C1' }))
      .mockResolvedValueOnce(jsonResp({ id: 'M1' }))
      .mockResolvedValueOnce(jsonResp({ permalink: 'x' }));

    await api.postImage(cfg, 'https://cdn.example.com/img.jpg', 'hi');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`/${cfg.userId}/media`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(init.body).toContain('image_url=');
    expect(init.body).toContain('caption=hi');
    expect(init.body).toContain(`access_token=${cfg.accessToken}`);
  });

  it('publish request sends creation_id from container response', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResp({ id: 'CONTAINER_777' }))
      .mockResolvedValueOnce(jsonResp({ id: 'M' }))
      .mockResolvedValueOnce(jsonResp({ permalink: 'x' }));

    await api.postImage(cfg, 'https://cdn.example.com/x.jpg', 'caption');

    const publishCall = fetchMock.mock.calls[1];
    expect(publishCall[1].body).toContain('creation_id=CONTAINER_777');
  });

  it('returns id without permalink when permalink lookup fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResp({ id: 'C' }))
      .mockResolvedValueOnce(jsonResp({ id: 'MEDIA_X' }))
      .mockResolvedValueOnce(textResp('not found', 404));

    const result = await api.postImage(cfg, 'https://cdn.example.com/x.jpg', 'c');
    expect(result).toEqual({ id: 'MEDIA_X', permalink: undefined });
  });

  it('container failure aborts before publish', async () => {
    fetchMock.mockResolvedValueOnce(
      textResp(JSON.stringify({ error: { message: 'Bad image URL', code: 100 } }), 400),
    );
    await expect(api.postImage(cfg, 'http://broken', 'x')).rejects.toThrow(/Bad image URL/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // publish 호출 안 됨
  });
});

// ── postCarousel ──

describe('postCarousel', () => {
  it('rejects when fewer than 2 images', async () => {
    await expect(api.postCarousel(cfg, ['https://cdn/1.jpg'], 'x')).rejects.toThrow(/2~10/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when more than 10 images', async () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://cdn/${i}.jpg`);
    await expect(api.postCarousel(cfg, urls, 'x')).rejects.toThrow(/2~10/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs 3-step flow: 3 child containers → carousel container → publish → permalink', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResp({ id: 'CHILD_1' }))
      .mockResolvedValueOnce(jsonResp({ id: 'CHILD_2' }))
      .mockResolvedValueOnce(jsonResp({ id: 'CHILD_3' }))
      .mockResolvedValueOnce(jsonResp({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResp({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResp({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResp({ id: 'CAROUSEL_X' }))
      .mockResolvedValueOnce(jsonResp({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResp({ id: 'MEDIA_Y' }))
      .mockResolvedValueOnce(jsonResp({ permalink: 'https://www.instagram.com/p/y/' }));

    const result = await api.postCarousel(
      cfg,
      ['https://cdn/1.jpg', 'https://cdn/2.jpg', 'https://cdn/3.jpg'],
      'three pics',
    );

    expect(result.id).toBe('MEDIA_Y');
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('children containers use is_carousel_item=true', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResp({ id: 'C1' }))
      .mockResolvedValueOnce(jsonResp({ id: 'C2' }))
      .mockResolvedValueOnce(jsonResp({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResp({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResp({ id: 'CAROUSEL' }))
      .mockResolvedValueOnce(jsonResp({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResp({ id: 'M' }))
      .mockResolvedValueOnce(jsonResp({ permalink: 'x' }));

    await api.postCarousel(cfg, ['https://cdn/1.jpg', 'https://cdn/2.jpg'], 'cap');

    expect(fetchMock.mock.calls[0][1].body).toContain('is_carousel_item=true');
    expect(fetchMock.mock.calls[1][1].body).toContain('is_carousel_item=true');
  });

  it('carousel container sends media_type=CAROUSEL + children=joined IDs + caption', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResp({ id: 'C1' }))
      .mockResolvedValueOnce(jsonResp({ id: 'C2' }))
      .mockResolvedValueOnce(jsonResp({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResp({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResp({ id: 'CAR' }))
      .mockResolvedValueOnce(jsonResp({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResp({ id: 'M' }))
      .mockResolvedValueOnce(jsonResp({ permalink: 'x' }));

    await api.postCarousel(cfg, ['https://cdn/1.jpg', 'https://cdn/2.jpg'], 'caption text');

    const carouselCall = fetchMock.mock.calls[4];
    expect(carouselCall[1].body).toContain('media_type=CAROUSEL');
    expect(carouselCall[1].body).toContain('children=C1%2CC2');
    expect(carouselCall[1].body).toContain('caption=caption+text');
  });

  it('aborts if any child container fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResp({ id: 'C1' }))
      .mockResolvedValueOnce(textResp(JSON.stringify({ error: { message: 'bad image', code: 100 } }), 400));

    await expect(
      api.postCarousel(cfg, ['https://cdn/1.jpg', 'https://cdn/broken.jpg'], 'x'),
    ).rejects.toThrow(/bad image/);
    expect(fetchMock).toHaveBeenCalledTimes(2); // carousel/publish 호출 없음
  });
});
