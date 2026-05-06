import { google } from 'googleapis';
import http from 'node:http';
import open from 'open';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getMcpOAuthClient } from './constants.js';
import { AuthError, classifyError, type AuthErrorPayload } from './errors.js';

const SCOPES = [
  'https://www.googleapis.com/auth/firebase',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/admob.readonly',
  'https://www.googleapis.com/auth/admob.monetization',
  'https://www.googleapis.com/auth/androidpublisher',
];

// Primary config dir. Legacy `~/.preseed` is read as a fallback during the
// rebrand so existing auth sessions don't force a re-login; new writes go to
// the new dir.
const TOKEN_DIR = path.join(os.homedir(), '.mimi-seed');
const LEGACY_TOKEN_DIR = path.join(os.homedir(), '.preseed');
const TOKEN_PATH = path.join(TOKEN_DIR, 'tokens.json');
const LEGACY_TOKEN_PATH = path.join(LEGACY_TOKEN_DIR, 'tokens.json');
const CREDENTIALS_PATH = path.join(TOKEN_DIR, 'credentials.json');

// Default OAuth client for development — users should replace with their own
const DEFAULT_CLIENT_ID = ''; // Will be set during auth setup
const DEFAULT_CLIENT_SECRET = '';

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
}

function ensureDir() {
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
  }
}

export function getStoredCredentials(): { clientId: string; clientSecret: string } | null {
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    return { clientId: data.clientId, clientSecret: data.clientSecret };
  } catch {
    return null;
  }
}

export function saveCredentials(clientId: string, clientSecret: string) {
  ensureDir();
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify({ clientId, clientSecret }, null, 2), { mode: 0o600 });
}

export function getStoredTokens(): StoredTokens | null {
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

function saveTokens(tokens: StoredTokens) {
  ensureDir();
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function createOAuth2Client(clientId: string, clientSecret: string) {
  return new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:9876/callback');
}

/**
 * Get authenticated OAuth2 client.
 * Returns null if not authenticated yet.
 */
export function getAuthenticatedClient(): ReturnType<typeof createOAuth2Client> | null {
  const creds = getStoredCredentials();
  if (!creds) return null;

  const tokens = getStoredTokens();
  if (!tokens) return null;

  const client = createOAuth2Client(creds.clientId, creds.clientSecret);
  client.setCredentials(tokens);

  // Auto-refresh
  client.on('tokens', (newTokens) => {
    const stored = getStoredTokens();
    if (stored) {
      saveTokens({
        ...stored,
        ...(newTokens.access_token && { access_token: newTokens.access_token }),
        ...(newTokens.refresh_token && { refresh_token: newTokens.refresh_token }),
        ...(newTokens.expiry_date && { expiry_date: newTokens.expiry_date }),
      });
    }
  });

  return client;
}

// 동시 실행 방지용 — 활성 콜백 서버 참조
let activeAuthServer: http.Server | null = null;

/**
 * OAuth 플로우 시작.
 * URL과 대기 Promise를 즉시 반환. localhost:9876 콜백 서버는 백그라운드로 실행.
 * 호출자가 URL을 사용자에게 전달하거나 `open()`을 직접 호출.
 * `wait` Promise: 토큰 저장 시 resolve, 타임아웃/에러 시 reject.
 * 재호출 시 기존 세션 자동 정리.
 */
export function startAuth(
  clientId: string,
  clientSecret: string,
  options: { timeoutMs?: number } = {},
): { url: string; wait: Promise<StoredTokens> } {
  if (activeAuthServer) {
    try { activeAuthServer.close(); } catch { /* noop */ }
    activeAuthServer = null;
  }

  saveCredentials(clientId, clientSecret);
  const oauth2Client = createOAuth2Client(clientId, clientSecret);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  const wait = new Promise<StoredTokens>((resolve, reject) => {
    const rejectAuth = (e: unknown) => reject(new AuthError(classifyError(e, { phase: 'login' })));
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, `http://localhost:9876`);
        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end();
          return;
        }
        // Google이 동의 거부 시 ?error=access_denied 로 콜백
        const errParam = url.searchParams.get('error');
        if (errParam) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<html><body><h2>❌ 인증 거부됨 (${errParam})</h2></body></html>`);
          try { server.close(); } catch { /* noop */ }
          activeAuthServer = null;
          rejectAuth(new Error(errParam));
          return;
        }
        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400);
          res.end('No code');
          return;
        }
        let tokenResponse;
        try {
          tokenResponse = await oauth2Client.getToken(code);
        } catch (e) {
          res.writeHead(500);
          res.end('Code exchange failed');
          try { server.close(); } catch { /* noop */ }
          activeAuthServer = null;
          rejectAuth(e);
          return;
        }
        const tokens = tokenResponse.tokens;
        if (!tokens.access_token || !tokens.refresh_token) {
          res.writeHead(500);
          res.end('Token response invalid');
          try { server.close(); } catch { /* noop */ }
          activeAuthServer = null;
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
        const stored: StoredTokens = {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_type: tokens.token_type ?? 'Bearer',
          expiry_date: tokens.expiry_date ?? Date.now() + 3600_000,
        };
        saveTokens(stored);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
            <div style="text-align:center">
              <h1>✅ Mimi Seed 인증 완료!</h1>
              <p>이 창을 닫고 Claude Code로 돌아가세요.</p>
            </div>
          </body></html>
        `);

        server.close();
        activeAuthServer = null;
        resolve(stored);
      } catch (err) {
        try {
          res.writeHead(500);
          res.end('Auth error');
        } catch { /* noop — already responded */ }
        try { server.close(); } catch { /* noop */ }
        activeAuthServer = null;
        rejectAuth(err);
      }
    });

    server.on('error', (err) => {
      rejectAuth(err);
    });

    server.listen(9876, () => {
      activeAuthServer = server;
    });

    const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    setTimeout(() => {
      if (server.listening) {
        try { server.close(); } catch { /* noop */ }
        activeAuthServer = null;
        rejectAuth(new Error(`Auth timeout (${Math.round(timeoutMs / 1000)}s).`));
      }
    }, timeoutMs);
  });

  return { url: authUrl, wait };
}

/**
 * Interactive login — opens browser, waits for callback.
 * startAuth() 래퍼 — CLI에서 사용.
 */
export async function login(clientId: string, clientSecret: string): Promise<StoredTokens> {
  const { url, wait } = startAuth(clientId, clientSecret);
  console.log('🔐 브라우저에서 Google 로그인 중...');
  open(url);
  return wait;
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
export async function ensureFreshAccessToken(marginMs = 60_000): Promise<RefreshStatus> {
  const tokens = getStoredTokens();
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

  // refresh 시도 — credentials.json 우선, 없으면 원격에서 클라이언트 조회
  const stored = getStoredCredentials();
  const { clientId: defaultId, clientSecret: defaultSecret } = await getMcpOAuthClient();
  const clientId = stored?.clientId ?? defaultId;
  const clientSecret = stored?.clientSecret ?? defaultSecret;

  const client = createOAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: tokens.refresh_token });

  try {
    const { credentials } = await client.refreshAccessToken();
    const refreshed: StoredTokens = {
      access_token: credentials.access_token ?? tokens.access_token,
      refresh_token: credentials.refresh_token ?? tokens.refresh_token,
      token_type: credentials.token_type ?? tokens.token_type ?? 'Bearer',
      expiry_date: credentials.expiry_date ?? Date.now() + 3600_000,
    };
    saveTokens(refreshed);
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
