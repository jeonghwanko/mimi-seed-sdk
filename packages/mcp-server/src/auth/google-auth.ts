import { google } from '../lib/googleapis-lite.js';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { verifyYouTubeChannel, YOUTUBE_CHANNEL_ID } from './youtube-channel.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getMcpOAuthClient } from './constants.js';
import { AuthError, classifyError, type AuthErrorPayload } from './errors.js';

// 스코프 목록의 SSOT 는 scopes.ts (도메인 → 스코프 매핑). 여기서는 로그인 요청 조립만 한다.
import { scopesForDomains, type AuthDomainId } from './scopes.js';
import { writeCredentialJson } from '../lib/atomic-write.js';

export type { AuthDomainId } from './scopes.js';

// Primary config dir. Legacy `~/.preseed` is read as a fallback during the
// rebrand so existing auth sessions don't force a re-login; new writes go to
// the new dir.
const TOKEN_DIR = path.join(os.homedir(), '.mimi-seed');
const LEGACY_TOKEN_DIR = path.join(os.homedir(), '.preseed');
const TOKEN_PATH = path.join(TOKEN_DIR, 'tokens.json');
const LEGACY_TOKEN_PATH = path.join(LEGACY_TOKEN_DIR, 'tokens.json');
const CREDENTIALS_PATH = path.join(TOKEN_DIR, 'credentials.json');

export const GOOGLE_PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export function googleProfilePath(profile: string): string {
  if (!GOOGLE_PROFILE_ID.test(profile)) throw new Error('Invalid Google profile ID: use lowercase letters, digits, _ or - (1–64 characters).');
  return path.join(TOKEN_DIR, 'google-profiles', `${profile}.json`);
}

type OAuthCredentials = { clientId: string; clientSecret: string };
type GoogleProfile = { credentials: OAuthCredentials; tokens: StoredTokens };
function readProfile(profile: string): GoogleProfile | null {
  const file = googleProfilePath(profile);
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) as GoogleProfile; } catch { return null; }
}

/** Only safe metadata; never return tokens or OAuth client secrets to MCP callers. */
export function listGoogleProfiles() {
  const dir = path.join(TOKEN_DIR, 'google-profiles');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((file) => file.endsWith('.json') && GOOGLE_PROFILE_ID.test(file.slice(0, -5)))
    .sort().map((file) => {
      const profile = file.slice(0, -5);
      const tokens = readProfile(profile)?.tokens;
      return { profile, connected: !!tokens?.refresh_token, youtubeChannel: tokens?.youtubeChannel ?? null };
    });
}

export interface StoredTokens {
  youtubeChannel?: { id: string; title: string };
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
  /** 공백 구분 부여 스코프. 신규 도구(GA4 등) pre-flight 스코프 검사에 사용. 구 토큰은 undefined. */
  scope?: string;
}

export function getStoredCredentials(profile?: string): { clientId: string; clientSecret: string } | null {
  if (profile !== undefined) return readProfile(profile)?.credentials ?? null;
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    return { clientId: data.clientId, clientSecret: data.clientSecret };
  } catch {
    return null;
  }
}

export function saveCredentials(clientId: string, clientSecret: string) {
  writeCredentialJson(CREDENTIALS_PATH, { clientId, clientSecret });
}

export function getStoredTokens(profile?: string): StoredTokens | null {
  if (profile !== undefined) return readProfile(profile)?.tokens ?? null;
  // Prefer new dir; fall back to legacy ~/.preseed during the rebrand window.
  const pathToRead = fs.existsSync(TOKEN_PATH)
    ? TOKEN_PATH
    : fs.existsSync(LEGACY_TOKEN_PATH)
      ? LEGACY_TOKEN_PATH
      : null;
  if (!pathToRead) return null;
  try {
    return JSON.parse(fs.readFileSync(pathToRead, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * tokens.json mtime — 마지막 refresh 시각의 근사값.
 * (saveTokens 가 매번 writeFileSync 으로 갱신하므로 mtime ≈ 마지막 갱신/저장.)
 * Google refresh_token 은 7일(미인증 앱) ~ 6개월(인증 앱) 미사용 시 revoke 됨.
 * auth_status 응답 enrichment 에 사용.
 */
export function getTokensLastRefreshMs(profile?: string): number | null {
  if (profile !== undefined) {
    const file = googleProfilePath(profile);
    try { return fs.statSync(file).mtimeMs; } catch { return null; }
  }
  const pathToRead = fs.existsSync(TOKEN_PATH)
    ? TOKEN_PATH
    : fs.existsSync(LEGACY_TOKEN_PATH)
      ? LEGACY_TOKEN_PATH
      : null;
  if (!pathToRead) return null;
  try {
    return fs.statSync(pathToRead).mtimeMs;
  } catch {
    return null;
  }
}

// 원자적 교체가 특히 중요한 지점 — 이 함수는 access_token 만료 5분 전마다 다시 불리고,
// MCP 서버 인스턴스 여러 개와 CLI 가 같은 tokens.json 을 동시에 노린다.
function saveTokens(tokens: StoredTokens, profile?: string, credentials?: OAuthCredentials) {
  if (profile !== undefined) {
    const creds = credentials ?? getStoredCredentials(profile);
    if (!creds) throw new Error(`Missing OAuth credentials for profile ${profile}. Sign in again.`);
    // Client credentials and tokens belong to one grant and commit together.
    writeCredentialJson(googleProfilePath(profile), { credentials: creds, tokens });
  } else {
    if (credentials) saveCredentials(credentials.clientId, credentials.clientSecret);
    writeCredentialJson(TOKEN_PATH, tokens);
  }
}

export function createOAuth2Client(clientId: string, clientSecret: string) {
  return new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:9876/callback');
}

/**
 * Get authenticated OAuth2 client.
 * Returns null if not authenticated yet.
 */
export function getAuthenticatedClient(profile?: string): ReturnType<typeof createOAuth2Client> | null {
  const creds = getStoredCredentials(profile);
  if (!creds) return null;

  const tokens = getStoredTokens(profile);
  if (!tokens) return null;

  const client = createOAuth2Client(creds.clientId, creds.clientSecret);
  client.setCredentials(tokens);

  // Auto-refresh
  client.on('tokens', (newTokens) => {
    const stored = getStoredTokens(profile);
    if (stored && stored.refresh_token === tokens.refresh_token) {
      saveTokens({
        ...stored,
        ...(newTokens.access_token && { access_token: newTokens.access_token }),
        ...(newTokens.refresh_token && { refresh_token: newTokens.refresh_token }),
        ...(newTokens.expiry_date && { expiry_date: newTokens.expiry_date }),
        ...(newTokens.scope && { scope: newTokens.scope }),
      }, profile);
    }
  });

  return client;
}

// 동시 실행 방지용 — 활성 콜백 서버 참조
let cancelActiveAuth: (() => void) | null = null;
const authAttempts = new Map<string, { status: 'pending' | 'succeeded' | 'failed'; expectedChannelId?: string }>();
export function getGoogleAuthAttempt(profile?: string) { return authAttempts.get(profile ?? '') ?? null; }

/**
 * OAuth 플로우 시작.
 * URL과 대기 Promise를 즉시 반환. localhost:9876 콜백 서버는 백그라운드로 실행.
 * 호출자가 URL을 사용자에게 전달하거나 private 브라우저를 직접 연다.
 * `wait` Promise: 토큰 저장 시 resolve, 타임아웃/에러 시 reject.
 * 재호출 시 기존 세션 자동 정리.
 *
 * `domains` 로 권한 도메인 서브셋만 요청할 수 있다 (미지정 시 전체 — 기존 동작).
 * include_granted_scopes 덕에 재로그인은 기존 부여 스코프를 유지한 채 새 스코프만
 * 얹는다(incremental authorization) — 토큰 응답의 scope 필드에도 누적 전체가 온다.
 */
export function startAuth(
  clientId: string,
  clientSecret: string,
  options: { timeoutMs?: number; domains?: readonly AuthDomainId[]; profile?: string; expectedChannelId?: string } = {},
): { url: string; wait: Promise<StoredTokens> } {
  const { profile, expectedChannelId } = options;
  if (profile !== undefined) googleProfilePath(profile);
  if (expectedChannelId !== undefined && (!profile || !YOUTUBE_CHANNEL_ID.test(expectedChannelId))) {
    throw new Error('expectedChannelId requires a named profile and a valid YouTube channel ID.');
  }
  if (cancelActiveAuth) cancelActiveAuth();
  const attempt = { status: 'pending' as 'pending' | 'succeeded' | 'failed', expectedChannelId };
  authAttempts.set(profile ?? '', attempt);

  const oauth2Client = createOAuth2Client(clientId, clientSecret);
  const requestedScopes = scopesForDomains(expectedChannelId && options.domains ? [...new Set([...options.domains, 'youtube'] as AuthDomainId[])] : options.domains);
  const state = randomUUID();
  const authUrl = oauth2Client.generateAuthUrl({
    state,
    access_type: 'offline',
    scope: requestedScopes,
    // Private windows can still share cookies with an already-running private session.
    // Force Google to show the account chooser so an unrelated signed-in account is
    // never selected implicitly.
    prompt: 'consent select_account',
    include_granted_scopes: true,
  });

  let exchanging = false;
  const wait = new Promise<StoredTokens>((resolve, reject) => {
    const rejectAuth = (e: unknown) => {
      attempt.status = 'failed';
      reject(new AuthError(classifyError(e, { phase: 'login' })));
    };
    // 핸들러 전체가 try/catch 로 감싸여 있고 모든 경로가 응답 후 rejectAuth 로 끝난다 —
    // createServer 가 void 를 기대하지만 여기서 새어 나갈 rejection 은 없다.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, `http://localhost:9876`);
        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end();
          return;
        }
        if (url.searchParams.get('state') !== state) {
          res.writeHead(400);
          res.end('Invalid OAuth state');
          return;
        }
        // Google이 동의 거부 시 ?error=access_denied 로 콜백
        const errParam = url.searchParams.get('error');
        if (errParam) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Google authentication was denied.');
          try { server.close(); } catch { /* noop */ }
          rejectAuth(new Error(errParam));
          return;
        }
        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400);
          res.end('No code');
          return;
        }
        if (attempt.status !== 'pending' || exchanging) {
          res.writeHead(409);
          res.end('Login is no longer accepting callbacks.');
          return;
        }
        exchanging = true;
        let tokenResponse;
        try {
          tokenResponse = await oauth2Client.getToken(code);
        } catch (e) {
          res.writeHead(500);
          res.end('Code exchange failed');
          try { server.close(); } catch { /* noop */ }
          rejectAuth(e);
          return;
        }
        const tokens = tokenResponse.tokens;
        if (!tokens.access_token || !tokens.refresh_token) {
          res.writeHead(500);
          res.end('Token response invalid');
          try { server.close(); } catch { /* noop */ }
          attempt.status = 'failed';
          reject(new AuthError({
            code: 'TOKEN_RESPONSE_INVALID',
            message: 'Google 응답에 access_token 또는 refresh_token이 누락되었습니다.',
            hint: 'OAuth 동의 화면에서 모든 권한에 동의했는지 확인하세요.',
            retriable: true,
            needsReauth: true,
            cause: JSON.stringify({ has_access: !!tokens.access_token, has_refresh: !!tokens.refresh_token }),
          }));
          return;
        }
        oauth2Client.setCredentials(tokens);
        const youtubeChannel = (expectedChannelId || (profile && requestedScopes.some((scope) => scope.includes('/auth/youtube'))))
          ? await verifyYouTubeChannel(oauth2Client, expectedChannelId) : undefined;
        // A fresh login may be another Google account. Never union its scopes with
        // the previous account's grant; Google's response is authoritative.
        const stored: StoredTokens = {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_type: tokens.token_type ?? 'Bearer',
          expiry_date: tokens.expiry_date ?? Date.now() + 3600_000,
          scope: tokens.scope ?? requestedScopes.join(' '),
          ...(youtubeChannel && { youtubeChannel }),
        };
        if (attempt.status !== 'pending') throw new Error('Login cancelled or timed out; credentials were not saved.');
        saveTokens(stored, profile, { clientId, clientSecret });

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
            <div style="text-align:center">
              <h1>✅ Mimi Seed 인증 완료!</h1>
              <p>이 창을 닫고 Claude Code 또는 Codex로 돌아가세요.</p>
            </div>
          </body></html>
        `);

        server.close();
        attempt.status = 'succeeded';
        resolve(stored);
      } catch (err) {
        try {
          res.writeHead(500);
          res.end(err instanceof Error && err.message.startsWith('YouTube') ? err.message : 'Auth error. Check the MCP/CLI login status.');
        } catch { /* noop — already responded */ }
        try { server.close(); } catch { /* noop */ }
        rejectAuth(err);
      }
    });

    cancelActiveAuth = () => {
      if (attempt.status !== 'pending') return;
      try { server.close(); } catch { /* noop */ }
      rejectAuth(new Error('Login replaced by a new authentication request.'));
    };

    server.on('error', (err) => {
      rejectAuth(err);
    });

    server.listen(9876, () => {
      // Callback server is ready.
    });

    const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    setTimeout(() => {
      if (server.listening) {
        try { server.close(); } catch { /* noop */ }
        rejectAuth(new Error(`Auth timeout (${Math.round(timeoutMs / 1000)}s).`));
      }
    }, timeoutMs).unref();
  });

  return { url: authUrl, wait };
}

export type RefreshStatus =
  | { status: 'fresh'; tokens: StoredTokens; msUntilExpiry: number }
  | { status: 'refreshed'; tokens: StoredTokens; msUntilExpiry: number }
  | { status: 'expired_refresh_failed'; tokens: StoredTokens; error: AuthErrorPayload }
  | { status: 'unauthenticated'; error: AuthErrorPayload };

/**
 * 저장된 access_token이 만료/곧만료면 refresh_token으로 silent 갱신 시도.
 * - 갱신 성공 시 tokens.json 업데이트
 * - refresh_token 자체가 invalid한 경우 'expired_refresh_failed' 반환
 * - 토큰 자체가 없으면 'unauthenticated'
 *
 * MCP 도구와 CLI 양쪽에서 공유.
 */
/**
 * 사전 갱신 마진. 기존 60_000(1분)에서 300_000(5분)으로 상향 — Google OAuth access_token 의
 * 통상 lifetime 이 1h 이므로, 5분 마진으로 매 도구 호출 시 만료 임박 시 사전 갱신해
 * "토큰 만료 → 도구 fail → 재호출" 의 단절 마찰 제거. 5분 마진은 평균 도구 작업 시간을 흡수.
 */
export async function ensureFreshAccessToken(marginMs = 300_000, profile?: string): Promise<RefreshStatus> {
  const tokens = getStoredTokens(profile);
  if (!tokens) {
    return {
      status: 'unauthenticated',
      error: {
        code: 'UNAUTHENTICATED',
        message: '저장된 인증 토큰이 없습니다.',
        hint: 'mimi-seed-auth 로 로그인하세요.',
        retriable: false,
        needsReauth: true,
      },
    };
  }

  const now = Date.now();
  const msUntilExpiry = (tokens.expiry_date ?? 0) - now;
  if (tokens.expiry_date && msUntilExpiry > marginMs) {
    return { status: 'fresh', tokens, msUntilExpiry };
  }

  if (!tokens.refresh_token) {
    return {
      status: 'expired_refresh_failed',
      tokens,
      error: {
        code: 'NO_REFRESH_TOKEN',
        message: '저장된 토큰에 refresh_token이 없습니다 (offline_access 미발급).',
        hint: 'mimi-seed-auth 로 재로그인하면 prompt=consent로 새 refresh_token이 발급됩니다.',
        retriable: false,
        needsReauth: true,
      },
    };
  }

  // refresh 시도 — credentials.json(디스크) 우선. 디스크에 있으면 원격 조회 자체를 안 한다 —
  // 매시간 refresh 가 웹 콘솔 생존에 의존하면 콘솔 장애가 모든 로컬 도구 호출을 죽인다.
  // 없을 때만 env → 원격(getMcpOAuthClient) 순으로 받고, 성공 시 디스크에 저장해
  // 원격 의존을 최초 1회로 끝낸다. 조회 실패는 raw throw 가 아니라 분류된 에러로 반환.
  let clientId: string;
  let clientSecret: string;
  const stored = getStoredCredentials(profile);
  if (stored?.clientId && stored?.clientSecret) {
    ({ clientId, clientSecret } = stored);
  } else {
    try {
      if (profile !== undefined) throw new Error(`Missing credentials for profile ${profile}. Sign in again.`);
      ({ clientId, clientSecret } = await getMcpOAuthClient());
      saveCredentials(clientId, clientSecret);
    } catch (e: unknown) {
      return {
        status: 'expired_refresh_failed',
        tokens,
        error: classifyError(e, { phase: 'refresh' }),
      };
    }
  }

  const client = createOAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: tokens.refresh_token });

  try {
    const { credentials } = await client.refreshAccessToken();
    const refreshed: StoredTokens = {
      ...tokens,
      access_token: credentials.access_token ?? tokens.access_token,
      refresh_token: credentials.refresh_token ?? tokens.refresh_token,
      token_type: credentials.token_type ?? tokens.token_type ?? 'Bearer',
      expiry_date: credentials.expiry_date ?? Date.now() + 3600_000,
      // refresh 응답은 scope 를 생략할 수 있으므로 기존 값을 보존(blank 방지).
      scope: credentials.scope ?? tokens.scope,
    };
    if (getStoredTokens(profile)?.refresh_token !== tokens.refresh_token) {
      throw new Error('Google login changed during refresh. Retry with the selected profile.');
    }
    saveTokens(refreshed, profile);
    return {
      status: 'refreshed',
      tokens: refreshed,
      msUntilExpiry: refreshed.expiry_date - Date.now(),
    };
  } catch (e: unknown) {
    return {
      status: 'expired_refresh_failed',
      tokens,
      error: classifyError(e, { phase: 'refresh' }),
    };
  }
}
