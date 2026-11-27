import { request } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from '../lib/http.js';
import { connectInstagram } from '../instagram/setup.js';
import { connectThreads } from '../threads/setup.js';
import {
  buildAuthorizeUrl, connectWithMetaApp, exchangeCode, parsePastedRedirect, MetaDirectLoginError,
} from '../social/meta-direct-login.js';
import {
  isLoopbackRedirect, isValidRedirectUri, loadMetaApp, metaAppsPath, saveMetaApp, type MetaAppConfig,
} from '../social/meta-app-config.js';

vi.mock('../auth/browser.js', () => ({ openSystemBrowser: vi.fn() }));
vi.mock('../lib/http.js', () => ({ fetchWithTimeout: vi.fn() }));
vi.mock('../instagram/setup.js', () => ({ connectInstagram: vi.fn() }));
vi.mock('../threads/setup.js', () => ({ connectThreads: vi.fn() }));

const SECRET = 'exampleappsecret0123456789abcdef';
const pasteApp: MetaAppConfig = { appId: '1234567890', appSecret: SECRET, redirectUri: 'https://localhost:8765/callback' };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const stateOf = (url: string) => new URL(url).searchParams.get('state')!;

function mockTokenEndpoints() {
  vi.mocked(fetchWithTimeout).mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === 'POST') {
      const body = new URLSearchParams(String(init.body));
      expect(body.get('code')).toBe('example-code');
      expect(body.get('client_secret')).toBe(SECRET);
      return json({ access_token: 'short-token', user_id: 1 });
    }
    expect(url.searchParams.get('access_token')).toBe('short-token');
    return json({ access_token: 'long-token', token_type: 'bearer', expires_in: 5_183_944 });
  });
}

beforeEach(() => {
  vi.mocked(connectInstagram).mockResolvedValue({ ok: true, text: 'ig connected' });
  vi.mocked(connectThreads).mockResolvedValue({ ok: true, text: 'th connected' });
  mockTokenEndpoints();
});
afterEach(() => vi.clearAllMocks());

describe('authorize URL', () => {
  it('targets the provider with the registered redirect and publish scopes', () => {
    const ig = new URL(buildAuthorizeUrl('instagram', pasteApp, 'a'.repeat(64)));
    expect(ig.origin + ig.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(ig.searchParams.get('redirect_uri')).toBe(pasteApp.redirectUri);
    expect(ig.searchParams.get('scope')).toContain('instagram_business_content_publish');
    const th = new URL(buildAuthorizeUrl('threads', pasteApp, 'a'.repeat(64)));
    expect(th.origin).toBe('https://threads.net');
    expect(th.searchParams.get('scope')).toBe('threads_basic,threads_content_publish');
    expect(th.href).not.toContain(SECRET);
  });
});

describe('pasted redirect', () => {
  const state = 'b'.repeat(64);
  it('accepts the registered redirect with the matching state, ignoring Instagram\'s #_ suffix', () => {
    expect(parsePastedRedirect(`https://localhost:8765/callback?code=example-code&state=${state}#_`, pasteApp, state)).toBe('example-code');
  });
  it('rejects a different state, path, origin, or a bare code', () => {
    for (const input of [
      `https://localhost:8765/callback?code=x&state=${'c'.repeat(64)}`,
      `https://localhost:8765/other?code=x&state=${state}`,
      `https://evil.example/callback?code=x&state=${state}`,
      'example-code',
    ]) expect(() => parsePastedRedirect(input, pasteApp, state)).toThrow(expect.objectContaining({ code: 'state' }));
  });
  it('reports a denial', () => {
    expect(() => parsePastedRedirect(`https://localhost:8765/callback?error=access_denied&state=${state}`, pasteApp, state))
      .toThrow(expect.objectContaining({ code: 'denied' }));
  });
});

describe('code exchange', () => {
  it('does not retry the single-use code POST', async () => {
    await exchangeCode('threads', pasteApp, 'example-code');
    const post = vi.mocked(fetchWithTimeout).mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[2]).toMatchObject({ maxAttempts: 1 });
  });
  it('unwraps Instagram\'s data[] response shape', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValueOnce(json({ data: [{ access_token: 'short-token' }] }));
    await expect(exchangeCode('instagram', pasteApp, 'example-code')).resolves.toEqual({ accessToken: 'long-token', expiresInSeconds: 5_183_944 });
  });
  it('surfaces the provider reason without echoing the secret or code', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValueOnce(json({ error: { message: `redirect_uri mismatch for ${SECRET} example-code` } }, 400));
    const error = await exchangeCode('threads', pasteApp, 'example-code').catch((e: unknown) => e) as MetaDirectLoginError;
    expect(error.code).toBe('exchange');
    expect(error.detail).toContain('redirect_uri mismatch');
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain('example-code');
  });
  it('rejects an implausible token lifetime', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValueOnce(json({ access_token: 'short-token' }))
      .mockResolvedValueOnce(json({ access_token: 'long-token', expires_in: 10 ** 9 }));
    await expect(exchangeCode('threads', pasteApp, 'example-code')).rejects.toMatchObject({ code: 'exchange' });
  });
});

describe('connectWithMetaApp', () => {
  it('paste mode: exchanges the pasted code and saves through the verified path with the real lifetime', async () => {
    let authorize = '';
    const result = await connectWithMetaApp('threads', {
      app: pasteApp, profile: 'example',
      openBrowser: async (url) => { authorize = url; },
      readRedirect: async () => `https://localhost:8765/callback?code=example-code&state=${stateOf(authorize)}`,
    });
    expect(result).toEqual({ ok: true, text: 'th connected' });
    expect(connectThreads).toHaveBeenCalledWith('long-token', undefined, true, expect.objectContaining({ profile: 'example' }), 5_183_944);
  });

  it('paste mode without a reader is a configuration error, not a hang', async () => {
    await expect(connectWithMetaApp('threads', { app: pasteApp, openBrowser: async () => {} }))
      .rejects.toMatchObject({ code: 'configuration' });
  });

  it('loopback mode: captures the callback on the registered port and path only', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const app = { ...pasteApp, redirectUri: `http://127.0.0.1:${port}/cb` };
    const hit = (query: string, p = '/cb') => new Promise<number>((resolve, reject) => {
      const req = request(`http://127.0.0.1:${port}${p}?${query}`, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
      req.on('error', reject); req.end();
    });
    await connectWithMetaApp('instagram', {
      app, timeoutMs: 5000,
      openBrowser: async (url) => {
        const state = stateOf(url);
        expect(await hit(`code=x&state=${'0'.repeat(64)}`)).toBe(400);
        expect(await hit(`code=x&state=${state}`, '/wrong')).toBe(404);
        expect(await hit(`code=example-code&state=${state}`)).toBe(200);
      },
    });
    expect(connectInstagram).toHaveBeenCalledTimes(1);
  });

  it('loopback mode: times out without saving and releases the port', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const app = { ...pasteApp, redirectUri: `http://127.0.0.1:${port}/cb` };
    await expect(connectWithMetaApp('threads', { app, timeoutMs: 30, openBrowser: async () => {} }))
      .rejects.toMatchObject({ code: 'timeout' });
    expect(connectThreads).not.toHaveBeenCalled();
    await expect(connectWithMetaApp('threads', { app, timeoutMs: 30, openBrowser: async () => {} }))
      .rejects.toMatchObject({ code: 'timeout' });
  });

  it('does not report a failed account verification as success', async () => {
    vi.mocked(connectThreads).mockResolvedValue({ ok: false, text: 'nope' });
    let authorize = '';
    await expect(connectWithMetaApp('threads', {
      app: pasteApp, openBrowser: async (url) => { authorize = url; },
      readRedirect: async () => `https://localhost:8765/callback?code=example-code&state=${stateOf(authorize)}`,
    })).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('meta-apps.json', () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(path.join(os.tmpdir(), 'meta-apps-')); });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('round-trips per platform, keeps the other platform, and writes 0600', () => {
    saveMetaApp('instagram', pasteApp, home);
    saveMetaApp('threads', { ...pasteApp, appId: '9876543210' }, home);
    expect(loadMetaApp('instagram', home)).toEqual(pasteApp);
    expect(loadMetaApp('threads', home)?.appId).toBe('9876543210');
    if (process.platform !== 'win32') expect(statSync(metaAppsPath(home)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(metaAppsPath(home), 'utf8'))).toHaveProperty('instagram');
  });

  it('a corrupt file is an error, never silently overwritten, and its contents are not echoed', () => {
    mkdirSync(path.dirname(metaAppsPath(home)), { recursive: true });
    writeFileSync(metaAppsPath(home), `{"threads": {"appSecret": "${SECRET}"`);
    expect(() => loadMetaApp('instagram', home)).toThrow(/left unchanged/);
    expect(() => saveMetaApp('instagram', pasteApp, home)).toThrow(/left unchanged/);
    expect(readFileSync(metaAppsPath(home), 'utf8')).toContain(SECRET);
    try { loadMetaApp('instagram', home); } catch (error) { expect(String(error)).not.toContain(SECRET); }
  });

  it('refuses invalid settings', () => {
    expect(() => saveMetaApp('threads', { ...pasteApp, redirectUri: 'http://example.com/cb' }, home)).toThrow();
    expect(loadMetaApp('threads', home)).toBeNull();
  });

  it('classifies redirect URIs', () => {
    expect(isValidRedirectUri('https://localhost/callback')).toBe(true);
    expect(isValidRedirectUri('http://localhost:8765/cb')).toBe(true);
    expect(isValidRedirectUri('http://localhost/cb')).toBe(false); // no port to listen on
    expect(isValidRedirectUri('http://example.com:80/cb')).toBe(false);
    expect(isValidRedirectUri('https://example.com/cb?x=1')).toBe(false);
    expect(isLoopbackRedirect('http://[::1]:9000/cb')).toBe(true);
    expect(isLoopbackRedirect('https://localhost:8765/cb')).toBe(false);
  });
});
