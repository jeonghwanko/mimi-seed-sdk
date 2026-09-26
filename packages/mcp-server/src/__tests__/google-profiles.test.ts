import { once } from 'node:events';
import type { ReadStream } from 'node:fs';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted<{
  home: string; callback: unknown; tokenResponse: Record<string, unknown>;
  channelList: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>; clients: FakeClient[];
  requestedScopes: string[];
}>(() => ({
  home: '', callback: null, tokenResponse: {},
  channelList: vi.fn(), insert: vi.fn(), refresh: vi.fn(), clients: [], requestedScopes: [],
}));
class FakeClient {
  credentials: unknown;
  handler?: (tokens: Record<string, unknown>) => void;
  constructor() { h.clients.push(this); }
  setCredentials(tokens: unknown) { this.credentials = tokens; }
  on(_event: string, handler: (tokens: Record<string, unknown>) => void) { this.handler = handler; }
  generateAuthUrl(options: { state: string; scope: string[] }) {
    h.requestedScopes = options.scope;
    return `https://accounts.example.test/auth?state=${options.state}`;
  }
  getToken() { return Promise.resolve({ tokens: h.tokenResponse }); }
  refreshAccessToken() { return h.refresh(); }
}
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>();
  return { ...actual, default: { ...actual.default, homedir: () => h.home } };
});
vi.mock('../lib/googleapis-lite.js', () => ({ google: {
  auth: { OAuth2: FakeClient },
  youtube: () => ({ channels: { list: h.channelList }, videos: { insert: h.insert } }),
} }));
vi.mock('node:http', () => ({ default: {
  createServer: (callback: unknown) => {
    h.callback = callback;
    const server = { listening: false, on: vi.fn(), close: () => { server.listening = false; },
      listen: (_port: number, ready: () => void) => { server.listening = true; ready(); } };
    return server;
  },
} }));
vi.mock('../video/render.js', () => ({ validateVideo: vi.fn() }));

let auth: typeof import('../auth/google-auth.js');
const channelA = 'UC' + 'a'.repeat(22);
const channelB = 'UC' + 'b'.repeat(22);
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  // os.tmpdir remains real; no production credential directory is touched.
  h.home = mkdtempSync(path.join(os.tmpdir(), 'mimi-google-profile-'));
  h.clients = [];
  h.requestedScopes = [];
  h.tokenResponse = { access_token: 'test-access', refresh_token: 'test-refresh', expiry_date: Date.now() + 3600000,
    scope: 'https://www.googleapis.com/auth/youtube.force-ssl' };
  h.channelList.mockResolvedValue({ data: { items: [{ id: channelA, snippet: { title: 'Example A' } }] } });
  auth = await import('../auth/google-auth.js');
});
afterEach(() => { rmSync(h.home, { recursive: true, force: true }); });

async function callback(url: string, state?: string) {
  const req = { url: `/callback?code=example&state=${state ?? new URL(url).searchParams.get('state')}` };
  const res = { writeHead: vi.fn(), end: vi.fn() };
  await (h.callback as (req: unknown, res: unknown) => Promise<void>)(req, res);
  return res;
}
async function login(profile?: string, expectedChannelId?: string) {
  const flow = auth.startAuth('example-client', 'example-secret', { profile, expectedChannelId, domains: ['youtube'] });
  const settled = flow.wait.then(() => null, (error: unknown) => error);
  await callback(flow.url);
  const error = await settled;
  if (error) throw error instanceof Error ? error : new Error(String(error));
}

describe('Google account/channel profiles', () => {
  it('analytics-only channel login requests read scopes without publishing permission', async () => {
    h.tokenResponse.scope = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly';
    const flow = auth.startAuth('example-client', 'example-secret', {
      profile: 'channel-a', expectedChannelId: channelA, domains: ['youtube_analytics'],
    });
    // 발행 권한(youtube.force-ssl)은 없고, 계정 식별 스코프만 추가로 붙는다.
    expect(h.requestedScopes).toEqual([
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
    ]);
    await callback(flow.url);
    await flow.wait;
    expect(auth.getStoredTokens('channel-a')?.youtubeChannel?.id).toBe(channelA);
  });

  it('a requested missing profile does not fall back to the default login', async () => {
    await login();
    const { requireAuth } = await import('../helpers.js');
    await expect(requireAuth(undefined, 'missing')).rejects.toThrow();
  });

  it('계정별로 저장하고 기본 로그인으로 폴백하지 않으며 공개 목록에는 비밀값이 없다', async () => {
    await login();
    await login('channel-a', channelA);
    h.tokenResponse.refresh_token = 'test-refresh-b';
    h.channelList.mockResolvedValue({ data: { items: [{ id: channelB }] } });
    await login('channel-b', channelB);
    expect(auth.getStoredTokens()?.refresh_token).toBe('test-refresh');
    expect(auth.getStoredTokens('channel-a')?.youtubeChannel?.id).toBe(channelA);
    expect(auth.getStoredTokens('channel-b')?.refresh_token).toBe('test-refresh-b');
    expect(auth.getStoredTokens('missing')).toBeNull();
    expect(auth.getAuthenticatedClient('missing')).toBeNull();
    expect(JSON.stringify(auth.listGoogleProfiles())).not.toMatch(/test-refresh|example-secret|test-access/);
    expect(() => auth.getStoredTokens('../tokens')).toThrow('Invalid Google profile');
    expect(() => auth.getStoredTokens('')).toThrow('Invalid Google profile');
  });

  it('다른 채널 또는 채널 없는 로그인은 기존 프로필과 자격증명을 보존한다', async () => {
    await login('channel-a', channelA);
    const before = readFileSync(auth.googleProfilePath('channel-a'), 'utf8');
    h.channelList.mockResolvedValue({ data: { items: [{ id: channelB }] } });
    await expect(login('channel-a', channelA)).rejects.toThrow();
    expect(readFileSync(auth.googleProfilePath('channel-a'), 'utf8')).toBe(before);
    h.channelList.mockResolvedValue({ data: { items: [] } });
    await expect(login('empty', channelA)).rejects.toThrow();
    expect(existsSync(auth.googleProfilePath('empty'))).toBe(false);
  });

  it('잘못된 OAuth state는 저장하지 않고 올바른 콜백을 기다린다', async () => {
    const flow = auth.startAuth('example-client', 'example-secret', { profile: 'channel-a', domains: ['youtube'] });
    expect((await callback(flow.url, 'invalid')).writeHead).toHaveBeenCalledWith(400);
    expect(auth.getStoredTokens('channel-a')).toBeNull();
    await callback(flow.url);
    await flow.wait;
    expect(auth.getStoredTokens('channel-a')).not.toBeNull();
  });

  it('새 계정의 scope를 이전 계정과 합치지 않고 오래된 클라이언트의 refresh 저장을 차단한다', async () => {
    await login('channel-a', channelA);
    auth.getAuthenticatedClient('channel-a');
    const oldClient = h.clients.at(-1)!;
    h.tokenResponse = { ...h.tokenResponse, refresh_token: 'new-grant', scope: 'new-scope' };
    await login('channel-a', channelA);
    oldClient.handler?.({ access_token: 'stale-access' });
    expect(auth.getStoredTokens('channel-a')?.scope).toBe('new-scope');
    expect(auth.getStoredTokens('channel-a')?.access_token).toBe('test-access');
  });

  it('만료 토큰은 해당 프로필만 갱신하고 채널 메타데이터를 보존한다', async () => {
    await login('channel-a', channelA);
    h.tokenResponse = { ...h.tokenResponse, refresh_token: 'refresh-b', expiry_date: 1 };
    h.channelList.mockResolvedValue({ data: { items: [{ id: channelB }] } });
    await login('channel-b', channelB);
    h.refresh.mockResolvedValue({ credentials: { access_token: 'fresh-b', expiry_date: Date.now() + 3600000 } });
    expect((await auth.ensureFreshAccessToken(undefined, 'channel-b')).status).toBe('refreshed');
    expect(auth.getStoredTokens('channel-b')?.youtubeChannel?.id).toBe(channelB);
    expect(auth.getStoredTokens('channel-a')?.access_token).toBe('test-access');
  });

  it('검증된 채널의 클라이언트로 업로드하고 결과에 채널을 반환한다', async () => {
    const { validateVideo } = await import('../video/render.js');
    vi.mocked(validateVideo).mockResolvedValue({ streams: [{ codec_type: 'video', width: 1080, height: 1920 }],
      format: { duration: '28' }, issues: [] } as unknown as Awaited<ReturnType<typeof validateVideo>>);
    const { uploadYouTubeVideo } = await import('../video/youtube-publish.js');
    const filePath = path.join(h.home, 'example.mp4');
    writeFileSync(filePath, 'example video');
    const uploaded: { stream?: ReadStream } = {};
    h.insert.mockImplementation((request: { media: { body: ReadStream } }) => {
      uploaded.stream = request.media.body;
      request.media.body.destroy();
      return { data: { id: 'example-video', snippet: { channelId: channelA }, status: { privacyStatus: 'private' } } };
    });
    const result = await uploadYouTubeVideo(auth.createOAuth2Client('example-client', 'example-secret'), {
      filePath, title: 'Example', expectedChannelId: channelA,
    });
    if (uploaded.stream && !uploaded.stream.closed) await once(uploaded.stream, 'close');
    expect(result.channelId).toBe(channelA);
    expect(result.authenticatedChannel.id).toBe(channelA);
    expect(h.insert).toHaveBeenCalledOnce();
  });

  it('대상 채널 불일치 또는 여러 채널이면 파일 전송을 시작하지 않는다', async () => {
    const { uploadYouTubeVideo } = await import('../video/youtube-publish.js');
    const client = auth.createOAuth2Client('example-client', 'example-secret');
    const input = { filePath: '/unused.mp4', title: 'Example', expectedChannelId: channelB };
    await expect(uploadYouTubeVideo(client, input)).rejects.toThrow('channel mismatch');
    h.channelList.mockResolvedValue({ data: { items: [{ id: channelA }, { id: channelB }] } });
    await expect(uploadYouTubeVideo(client, input)).rejects.toThrow('exactly one');
    expect(h.insert).not.toHaveBeenCalled();
  });
});

function idToken(payload: Record<string, unknown>) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc(payload)}.signature`;
}

describe('로그인 계정 식별 (다른 계정 로그인이 "✅ 연결됨" 뒤에 숨지 않게)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('로그인 시 id_token 의 이메일을 저장하고 프로필 목록에 노출한다', async () => {
    h.tokenResponse.id_token = idToken({ email: 'owner@example.com' });
    await login('channel-a', channelA);
    expect(auth.getStoredTokens('channel-a')?.accountEmail).toBe('owner@example.com');
    expect(auth.listGoogleProfiles()).toEqual([
      expect.objectContaining({ profile: 'channel-a', accountEmail: 'owner@example.com' }),
    ]);
  });

  it('id_token 이 없거나 깨졌으면 이메일 없이 로그인은 성공한다', async () => {
    h.tokenResponse.id_token = 'not-a-jwt';
    await login();
    expect(auth.getStoredTokens()?.accountEmail).toBeUndefined();
    expect(auth.emailFromIdToken(undefined)).toBeUndefined();
  });

  it('기록된 이메일이 있으면 네트워크 없이 그대로 쓴다', async () => {
    h.tokenResponse.id_token = idToken({ email: 'owner@example.com' });
    await login();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await auth.resolveAccountEmail()).toBe('owner@example.com');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('기록이 없는 구 토큰은 tokeninfo 로 한 번 조회해 저장한다', async () => {
    await login();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'legacy@example.com' }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await auth.resolveAccountEmail()).toBe('legacy@example.com');
    expect(auth.getStoredTokens()?.accountEmail).toBe('legacy@example.com');
    expect(await auth.resolveAccountEmail()).toBe('legacy@example.com');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('조회 도중 다른 계정으로 재로그인되면 옛 이메일을 새 토큰에 붙이지 않는다', async () => {
    await login();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      h.tokenResponse = { ...h.tokenResponse, refresh_token: 'other-grant' };
      await login();
      return { ok: true, json: async () => ({ email: 'old@example.com' }) };
    }));
    await auth.resolveAccountEmail();
    expect(auth.getStoredTokens()?.refresh_token).toBe('other-grant');
    expect(auth.getStoredTokens()?.accountEmail).toBeUndefined();
  });

  it('조회 실패·email 미부여는 throw 하지 않고 null', async () => {
    await login();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await auth.resolveAccountEmail()).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await auth.resolveAccountEmail()).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await auth.resolveAccountEmail()).toBeNull();
    expect(await auth.resolveAccountEmail('missing')).toBeNull();
  });
});
