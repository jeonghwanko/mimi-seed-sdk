import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../tiktok-business/api.js';
import { configFromToken, hasTikTokScope, safeTokenInspection, tokenFreshness } from '../tiktok-business/auth.js';
import { __testing as posting } from '../tiktok-business/posting.js';
import type { TikTokBusinessConfig } from '../tiktok-business/config.js';

const config: TikTokBusinessConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.test/callback',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
  refreshTokenExpiresAt: '2031-01-01T00:00:00.000Z',
  openId: 'open-id',
  scope: 'video.publish,user.info.basic',
  tokenType: 'Bearer',
};

const response = (data: unknown, code = 0, status = 200) => new Response(
  JSON.stringify({ code, message: code === 0 ? 'OK' : 'bad request', request_id: 'req-1', data }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('TikTok API for Business client', () => {
  it('authorization code를 공식 short-term token payload로 교환한다', async () => {
    fetchMock.mockResolvedValueOnce(response({
      access_token: 'a', refresh_token: 'r', open_id: 'o', expires_in: 86_400,
      refresh_token_expires_in: 31_536_000, scope: 'video.publish', token_type: 'Bearer',
    }));

    await api.exchangeAuthorizationCode({
      clientId: 'id', clientSecret: 'secret', redirectUri: 'https://example.test/cb', authCode: 'code',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/open_api/v1.3/tt_user/oauth2/token/');
    expect(JSON.parse(String(init.body))).toEqual({
      client_id: 'id', client_secret: 'secret', grant_type: 'authorization_code',
      auth_code: 'code', redirect_uri: 'https://example.test/cb',
    });
  });

  it('공개 게시 요청은 Access-Token 헤더와 business_id를 사용한다', async () => {
    fetchMock.mockResolvedValueOnce(response({ share_id: 'publish-1' }));
    await expect(api.publishVideo(config, {
      business_id: config.openId,
      video_url: 'https://cdn.test/video.mp4?signature=secret',
      post_info: { caption: 'hello', is_ai_generated: true },
    })).resolves.toEqual({ share_id: 'publish-1' });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain('/business/video/publish/');
    expect((init.headers as Record<string, string>)['Access-Token']).toBe('access-token');
    expect(JSON.parse(String(init.body))).toMatchObject({ business_id: 'open-id' });
  });

  it('POST 네트워크 오류는 결과 불명으로 분류해 자동 재시도를 막는다', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket closed'));
    await expect(api.publishVideo(config, {
      business_id: config.openId,
      video_url: 'https://cdn.test/video.mp4',
      post_info: {},
    })).rejects.toMatchObject({ outcomeUnknown: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('공개 게시 POST는 429에서도 자동 재시도하지 않는다', async () => {
    fetchMock.mockResolvedValue(response({}, 42900, 429));
    await expect(api.publishVideo(config, {
      business_id: config.openId,
      video_url: 'https://cdn.test/video.mp4',
      post_info: {},
    })).rejects.toMatchObject({ outcomeUnknown: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('provider code 오류는 request id를 보존하되 토큰은 노출하지 않는다', async () => {
    fetchMock
      .mockResolvedValueOnce(response({}, 40100, 400))
      .mockResolvedValueOnce(response({}, 40100, 400));
    await expect(api.getBusinessAccount(config)).rejects.toMatchObject({ requestId: 'req-1' });
    await expect(api.getBusinessAccount({ ...config, accessToken: 'DO-NOT-LEAK' })).rejects.not.toThrow(
      /DO-NOT-LEAK/,
    );
  });
});

describe('token lifetime and local validation', () => {
  it('token 응답을 절대 만료 시각으로 바꾸고 비밀값을 유지한다', () => {
    const built = configFromToken(config, {
      access_token: 'new-a', refresh_token: 'new-r', open_id: 'new-o', expires_in: 60,
      refresh_token_expires_in: 120, scope: 'video.publish', token_type: 'Bearer',
    }, Date.parse('2026-01-01T00:00:00.000Z'));
    expect(built.accessTokenExpiresAt).toBe('2026-01-01T00:01:00.000Z');
    expect(built.refreshTokenExpiresAt).toBe('2026-01-01T00:02:00.000Z');
    expect(built.clientSecret).toBe('client-secret');
  });

  it('access token은 만료 5분 전부터 갱신 대상으로 본다', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    expect(tokenFreshness({
      ...config,
      accessTokenExpiresAt: new Date(now + 4 * 60_000).toISOString(),
      refreshTokenExpiresAt: new Date(now + 10_000_000).toISOString(),
    }, now).state).toBe('access_expired');
  });

  it('video.publish 스코프를 쉼표·공백 목록에서 정확히 판정한다', () => {
    expect(hasTikTokScope({ scope: 'user.info.basic,video.publish' }, 'video.publish')).toBe(true);
    expect(hasTikTokScope({ scope: 'user.info.basic video.upload' }, 'video.publish')).toBe(false);
  });

  it('token info는 허용 필드만 반환하고 provider 비밀값을 제거한다', () => {
    expect(safeTokenInspection(config, {
      open_id: 'open-id',
      scope: 'video.publish',
      access_token: 'DO-NOT-LEAK',
      client_secret: 'DO-NOT-LEAK-EITHER',
    })).toEqual({ providerVerified: true, openIdMatches: true, scope: 'video.publish' });
  });

  it('caption·멘션·FPS·서명 URL 감사 로그 정규화를 검사한다', () => {
    expect(() => posting.assertCaption('x'.repeat(2_201))).toThrow(/2,200/);
    expect(() => posting.assertCaption(Array.from({ length: 31 }, (_, i) => `@u${i}`).join(' '))).toThrow(/30/);
    expect(posting.fpsValue('30000/1001')).toBeCloseTo(29.97, 2);
    expect(posting.safeUrl('https://cdn.test/a.mp4?signature=secret')).toBe('https://cdn.test/a.mp4');
    expect(() => posting.assertThumbnailOffset(10_001, 10)).toThrow(/영상 길이/);
  });

  it('provider 상태를 감사 상태로 정규화한다', () => {
    expect(posting.statusState({ status: 'PUBLISH_COMPLETE' })).toBe('published');
    expect(posting.statusState({ publish_status: 'FAILED' })).toBe('failed');
    expect(posting.statusState({ status: 'PROCESSING' })).toBe('pending');
    expect(posting.shouldReleasePublishLock('pending', 'failed')).toBe(true);
    expect(posting.shouldReleasePublishLock('failed', 'failed')).toBe(false);
  });

  it('동일 계정·영상 게시 예약은 프로세스 간 원자적으로 하나만 허용한다', () => {
    const lockDir = mkdtempSync(path.join(os.tmpdir(), 'mimi-seed-tiktok-lock-'));
    try {
      posting.acquirePublishLock('open-id', 'content-hash', lockDir);
      expect(() => posting.acquirePublishLock('open-id', 'content-hash', lockDir)).toThrow(/이미 존재/);
      posting.releasePublishLock('open-id', 'content-hash', lockDir);
      expect(() => posting.acquirePublishLock('open-id', 'content-hash', lockDir)).not.toThrow();
    } finally {
      rmSync(lockDir, { recursive: true, force: true });
    }
  });
});
