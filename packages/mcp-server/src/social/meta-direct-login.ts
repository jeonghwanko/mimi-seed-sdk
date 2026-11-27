// Broker-free Instagram / Threads browser login with the user's own Meta app.
//
// The app secret never leaves this machine: the CLI opens the provider's authorize page, receives the
// authorization code (from a loopback callback, or from the redirected URL the user pastes back), exchanges it
// for a short-lived token, upgrades that to a long-lived (~60 day) token, then hands it to the same verified
// save path the MCP tools use (connectInstagram / connectThreads). Nothing is saved unless that verification
// succeeds, so a failed login keeps the existing connection.
//
// Two redirect modes, because Meta's rules for loopback redirects are inconsistent across products:
//   - http://localhost:<port>/<path> (or 127.0.0.1 / [::1]) — a local server catches the callback;
//   - any HTTPS URI (e.g. https://localhost/...) — the browser lands on a page that may not load, and the user
//     pastes the full address-bar URL back into the terminal.
// Both modes verify `state` before using the code.

import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fetchWithTimeout } from '../lib/http.js';
import { openSystemBrowser } from '../auth/browser.js';
import { connectInstagram } from '../instagram/setup.js';
import { connectThreads } from '../threads/setup.js';
import type { ConnectResult } from '../facebook/setup.js';
import { resolveSocialConfigTarget, type SocialConfigOptions } from './profile-store.js';
import { isLoopbackRedirect, isValidRedirectUri, type MetaAppConfig, type MetaLoginPlatform } from './meta-app-config.js';

export type MetaDirectLoginCode = 'configuration' | 'denied' | 'timeout' | 'state' | 'exchange' | 'validation';

export class MetaDirectLoginError extends Error {
  constructor(
    public readonly code: MetaDirectLoginCode,
    /** Provider's own reason (e.g. a redirect_uri mismatch), already scrubbed of the code and secret. */
    public readonly detail?: string,
  ) {
    super(`Meta direct login: ${code}${detail ? ` (${detail})` : ''}`);
  }
}

interface ProviderSpec {
  authorizeUrl: string;
  tokenUrl: string;
  longLivedUrl: string;
  longLivedGrant: string;
  scopes: string[];
}

/** Scopes cover what the instagram_* / threads_* tools call: account lookup and publishing. */
export const META_LOGIN_PROVIDERS: Record<MetaLoginPlatform, ProviderSpec> = {
  instagram: {
    authorizeUrl: 'https://www.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    longLivedUrl: 'https://graph.instagram.com/access_token',
    longLivedGrant: 'ig_exchange_token',
    scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
  },
  threads: {
    authorizeUrl: 'https://threads.net/oauth/authorize',
    tokenUrl: 'https://graph.threads.net/oauth/access_token',
    longLivedUrl: 'https://graph.threads.net/access_token',
    longLivedGrant: 'th_exchange_token',
    scopes: ['threads_basic', 'threads_content_publish'],
  },
};

const MAX_LIFETIME_SECONDS = 60 * 24 * 3600;

export function buildAuthorizeUrl(platform: MetaLoginPlatform, app: MetaAppConfig, state: string): string {
  const spec = META_LOGIN_PROVIDERS[platform];
  const url = new URL(spec.authorizeUrl);
  url.searchParams.set('client_id', app.appId);
  url.searchParams.set('redirect_uri', app.redirectUri);
  url.searchParams.set('scope', spec.scopes.join(','));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return url.href;
}

function sameState(actual: string, expected: string): boolean {
  return /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function validCode(code: string | null): code is string {
  return !!code && code.length <= 4096 && /^[A-Za-z0-9._~-]+$/.test(code);
}

/**
 * Extract the authorization code from a pasted redirect URL. The URL must point at the registered redirect
 * (same origin and path) and carry the expected state; a bare code is refused because it cannot be tied to
 * this login attempt.
 */
export function parsePastedRedirect(input: string, app: MetaAppConfig, state: string): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new MetaDirectLoginError('state'); }
  const expected = new URL(app.redirectUri);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) throw new MetaDirectLoginError('state');
  if (!sameState(url.searchParams.get('state') ?? '', state)) throw new MetaDirectLoginError('state');
  if (url.searchParams.has('error')) throw new MetaDirectLoginError('denied');
  // Instagram appends "#_" to the redirect; URL parsing already moves it into the fragment.
  const code = url.searchParams.get('code');
  if (!validCode(code)) throw new MetaDirectLoginError('exchange');
  return code;
}

function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join('***');
  return out.slice(0, 300);
}

/** Provider error reason without echoing tokens: only the documented message fields are read. */
function providerReason(body: string, secrets: string[]): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error_message?: unknown; error?: { message?: unknown } | null };
    const nested = parsed.error && typeof parsed.error === 'object' ? parsed.error.message : undefined;
    const message = typeof parsed.error_message === 'string' ? parsed.error_message
      : typeof nested === 'string' ? nested : undefined;
    return message ? scrub(message, secrets) : undefined;
  } catch {
    // A non-JSON error body has no documented reason field; the caller still fails with code 'exchange'.
    return undefined;
  }
}

async function readJson(response: Response, secrets: string[]): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!response.ok) throw new MetaDirectLoginError('exchange', providerReason(text, secrets));
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new MetaDirectLoginError('exchange');
  }
}

export interface LongLivedToken {
  accessToken: string;
  expiresInSeconds: number;
}

/** code → short-lived token → long-lived token. The code is single-use, so the POST is never retried. */
export async function exchangeCode(platform: MetaLoginPlatform, app: MetaAppConfig, code: string): Promise<LongLivedToken> {
  const spec = META_LOGIN_PROVIDERS[platform];
  const secrets = [app.appSecret, code];
  let shortLived: string;
  try {
    const response = await fetchWithTimeout(spec.tokenUrl, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: app.appId,
        client_secret: app.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: app.redirectUri,
        code,
      }).toString(),
    }, { timeoutMs: 30_000, maxAttempts: 1 });
    const body = await readJson(response, secrets);
    // Instagram has returned both { access_token } and { data: [{ access_token }] }.
    const record = Array.isArray(body.data) && body.data[0] && typeof body.data[0] === 'object'
      ? body.data[0] as Record<string, unknown> : body;
    if (typeof record.access_token !== 'string' || !record.access_token) throw new MetaDirectLoginError('exchange');
    shortLived = record.access_token;
  } catch (error) {
    if (error instanceof MetaDirectLoginError) throw error;
    throw new MetaDirectLoginError('exchange'); // network errors may quote the request; do not echo them
  }

  try {
    const url = new URL(spec.longLivedUrl);
    url.searchParams.set('grant_type', spec.longLivedGrant);
    url.searchParams.set('client_secret', app.appSecret);
    url.searchParams.set('access_token', shortLived);
    const body = await readJson(await fetchWithTimeout(url, { redirect: 'error' }, 30_000), [...secrets, shortLived]);
    const expiresIn = body.expires_in;
    if (typeof body.access_token !== 'string' || !body.access_token ||
        typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > MAX_LIFETIME_SECONDS) {
      throw new MetaDirectLoginError('exchange');
    }
    return { accessToken: body.access_token, expiresInSeconds: expiresIn };
  } catch (error) {
    if (error instanceof MetaDirectLoginError) throw error;
    throw new MetaDirectLoginError('exchange');
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
}

/** Wait for the provider to redirect to the loopback URI and return the code. */
async function captureLoopback(app: MetaAppConfig, state: string, timeoutMs: number, onReady: () => Promise<void>): Promise<string> {
  const redirect = new URL(app.redirectUri);
  let settled = false;
  let finish!: (code: string) => void;
  let fail!: (error: Error) => void;
  const result = new Promise<string>((resolve, reject) => { finish = resolve; fail = reject; });
  void result.catch(() => {});
  const handler: Parameters<typeof createServer>[1] = (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== redirect.pathname) { res.writeHead(404).end(); return; }
    if (!sameState(url.searchParams.get('state') ?? '', state)) { res.writeHead(400).end('Invalid login state.'); return; }
    if (settled) { res.writeHead(409).end('Login already handled.'); return; }
    if (url.searchParams.has('error')) {
      settled = true;
      res.writeHead(400).end('Login cancelled. Return to Mimi Seed.');
      fail(new MetaDirectLoginError('denied'));
      return;
    }
    const code = url.searchParams.get('code');
    if (!validCode(code)) { res.writeHead(400).end('Invalid callback.'); return; }
    settled = true;
    res.end('Approval received. Return to Mimi Seed to check the connection result.');
    finish(code);
  };

  // "localhost" may resolve to either loopback family in the browser, so listen on both when asked for it.
  const hosts = redirect.hostname === 'localhost' ? ['127.0.0.1', '::1']
    : [redirect.hostname === '[::1]' ? '::1' : redirect.hostname];
  const servers: Server[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    for (const host of hosts) {
      const server = createServer(handler);
      try {
        await listen(server, Number(redirect.port), host);
        servers.push(server);
      } catch (error) {
        // Only "this machine has no IPv6 loopback" is safe to skip. A port that is *in use* on either family must
        // fail: the browser may resolve localhost to that family and hand ?code&state to the other process, and
        // this login would then wait for the full timeout.
        const code = (error as NodeJS.ErrnoException).code;
        if (host === '::1' && hosts.length > 1 && (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT')) continue;
        throw new MetaDirectLoginError('configuration', `port ${redirect.port} is not available on ${host}`);
      }
    }
    if (servers.length === 0) throw new MetaDirectLoginError('configuration', `port ${redirect.port} is not available`);
    timer = setTimeout(() => { settled = true; fail(new MetaDirectLoginError('timeout')); }, timeoutMs);
    await onReady();
    return await result;
  } finally {
    if (timer) clearTimeout(timer);
    for (const server of servers) { server.close(); server.closeAllConnections(); }
  }
}

export interface MetaDirectLoginOptions extends SocialConfigOptions {
  app: MetaAppConfig;
  timeoutMs?: number;
  openBrowser?: (url: string) => Promise<void>;
  /** Called with the authorize URL so a CLI can print it when the browser does not open. */
  onUrl?: (url: string) => void;
  /** Paste mode (non-loopback redirect): returns the full redirected URL the user copied. */
  readRedirect?: () => Promise<string>;
}

export async function connectWithMetaApp(platform: MetaLoginPlatform, options: MetaDirectLoginOptions): Promise<ConnectResult> {
  const { app } = options;
  if (!isValidRedirectUri(app.redirectUri)) throw new MetaDirectLoginError('configuration');
  // Freeze the selected profile before any asynchronous work / directory changes.
  const target = resolveSocialConfigTarget(platform, options);
  const saveOptions = { ...options, profile: target.profile ?? undefined, startDir: options.startDir ?? process.cwd() };
  const timeoutMs = options.timeoutMs ?? 600_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new MetaDirectLoginError('configuration');

  const state = randomBytes(32).toString('hex');
  const authorizeUrl = buildAuthorizeUrl(platform, app, state);
  const open = async () => {
    options.onUrl?.(authorizeUrl);
    try { await (options.openBrowser ?? openSystemBrowser)(authorizeUrl); }
    catch { if (!options.onUrl) throw new MetaDirectLoginError('configuration', 'could not open a browser'); }
  };

  let code: string;
  if (isLoopbackRedirect(app.redirectUri)) {
    code = await captureLoopback(app, state, timeoutMs, open);
  } else {
    if (!options.readRedirect) throw new MetaDirectLoginError('configuration');
    await open();
    code = parsePastedRedirect(await options.readRedirect(), app, state);
  }

  const token = await exchangeCode(platform, app, code);
  const connect = platform === 'instagram' ? connectInstagram : connectThreads;
  // Resolve the canonical account ID from /me rather than the OAuth user_id (numeric ids can lose precision).
  const connected = await connect(token.accessToken, undefined, true, saveOptions, token.expiresInSeconds);
  // Keep the verifier's own reason (e.g. "not a professional account") — it is the same text the MCP tools show,
  // and the only thing that tells the user what to fix. Scrubbed anyway: it must never echo the token or secret.
  if (!connected.ok) throw new MetaDirectLoginError('validation', scrub(connected.text, [token.accessToken, app.appSecret, code]));
  return connected;
}
