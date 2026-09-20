import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { fetchWithTimeout } from '../lib/http.js';
import { openSystemBrowser } from '../auth/browser.js';
import { connectThreads } from './setup.js';
import { resolveSocialConfigTarget, type SocialConfigOptions } from '../social/profile-store.js';

export class ThreadsLoginError extends Error {
  constructor(public readonly code: 'configuration' | 'unavailable' | 'denied' | 'timeout' | 'exchange' | 'validation') {
    super(`Threads browser login: ${code}`);
  }
}

export interface BrowserLoginOptions extends SocialConfigOptions {
  webBase?: string;
  timeoutMs?: number;
  openBrowser?: (url: string) => Promise<void>;
  onUrl?: (url: string) => void;
}

/** The broker keeps the Meta app secret server-side; no token is passed through browser URLs. */
export async function connectThreadsInBrowser(options: BrowserLoginOptions = {}) {
  // Freeze the selected profile before any asynchronous work / directory changes.
  const target = resolveSocialConfigTarget('threads', options);
  const saveOptions = { ...options, profile: target.profile ?? undefined, startDir: options.startDir ?? process.cwd() };
  const base = new URL(options.webBase ?? process.env.MIMI_SEED_WEB_BASE ?? 'https://mimi-seed.pryzm.gg');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new ThreadsLoginError('configuration');
  }
  const state = randomBytes(32).toString('hex');
  const verifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  const timeoutMs = options.timeoutMs ?? 600_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new ThreadsLoginError('configuration');
  let finish!: (value: {code: string; ticket: string}) => void;
  let fail!: (error: Error) => void;
  let settled = false;
  const callback = new Promise<{code: string; ticket: string}>((resolve, reject) => { finish = resolve; fail = reject; });
  // A denial/timeout can arrive while opening the browser. Attach a handler immediately.
  void callback.catch(() => {});
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/threads/callback') { res.writeHead(404).end(); return; }
    const actual = url.searchParams.get('state') ?? '';
    if (!/^[a-f0-9]{64}$/.test(actual) || !timingSafeEqual(Buffer.from(actual), Buffer.from(state))) {
      res.writeHead(400).end('Invalid login state.'); return;
    }
    if (settled) { res.writeHead(409).end('Login already handled.'); return; }
    if (url.searchParams.has('error')) {
      settled = true; res.writeHead(400).end('Threads login cancelled. Return to Mimi Seed.');
      fail(new ThreadsLoginError('denied')); return;
    }
    const code = url.searchParams.get('code');
    const ticket = url.searchParams.get('ticket');
    if (!code || code.length > 4096 || !ticket || ticket.length > 8192) { res.writeHead(400).end('Invalid callback.'); return; }
    settled = true;
    res.end('Threads approval received. Return to Mimi Seed to check the connection result.');
    finish({code, ticket});
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new ThreadsLoginError('configuration');
    timer = setTimeout(() => { settled = true; fail(new ThreadsLoginError('timeout')); }, timeoutMs);
    const request = async (path: string, body: object) => {
      try {
        const response = await fetchWithTimeout(new URL(path, base), {
          method: 'POST', redirect: 'error', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
        }, 30_000);
        if (!response.ok) throw new ThreadsLoginError(response.status === 503 || response.status === 404 ? 'unavailable' : 'exchange');
        return await response.json() as Record<string, unknown>;
      } catch (error) {
        if (error instanceof ThreadsLoginError) throw error;
        // Network/provider exceptions may contain codes or tokens. Do not echo them.
        throw new ThreadsLoginError('unavailable');
      }
    };
    const start = await request('/api/threads-auth/start', {state, codeChallenge, callbackPort: address.port});
    if (typeof start.authorizationUrl !== 'string') throw new ThreadsLoginError('configuration');
    const authorize = new URL(start.authorizationUrl);
    if (authorize.origin !== base.origin || authorize.pathname !== '/api/threads-auth/authorize' || authorize.username || authorize.password) {
      throw new ThreadsLoginError('configuration');
    }
    options.onUrl?.(authorize.href);
    try { await (options.openBrowser ?? openSystemBrowser)(authorize.href); }
    catch { if (!options.onUrl) throw new ThreadsLoginError('unavailable'); }
    const result = await callback;
    const token = await request('/api/threads-auth/exchange', {...result, codeVerifier: verifier});
    if (typeof token.accessToken !== 'string' || !token.accessToken || typeof token.userId !== 'string' || !token.userId ||
        typeof token.expiresInSeconds !== 'number' || !Number.isFinite(token.expiresInSeconds) || token.expiresInSeconds <= 0 || token.expiresInSeconds > 60 * 24 * 3600) {
      throw new ThreadsLoginError('exchange');
    }
    const connected = await connectThreads(token.accessToken, token.userId, true, saveOptions, token.expiresInSeconds);
    if (!connected.ok) throw new ThreadsLoginError('validation');
    return connected;
  } finally {
    if (timer) clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  }
}
