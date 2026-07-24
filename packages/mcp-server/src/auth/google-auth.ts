import { google } from '../lib/googleapis-lite.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getMcpOAuthClient } from './constants.js';
import { AuthError, classifyError, type AuthErrorPayload } from './errors.js';
import { openPrivateBrowser } from './browser.js';

// 스코프 목록의 SSOT 는 scopes.ts (도메인 → 스코프 매핑). 여기서는 로그인 요청 조립만 한다.
import { scopesForDomains, mergeScopeStrings, type AuthDomainId } from './scopes.js';

export type { AuthDomainId } from './scopes.js';

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
  /** 공백 구분 부여 스코프. 신규 도구(GA4 등) pre-flight 스코프 검사에 사용. 구 토큰은 undefined. */
  scope?: string;
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

/**
 * tokens.json mtime — 마지막 refresh 시각의 근사값.
 * (saveTokens 가 매번 writeFileSync 으로 갱신하므로 mtime ≈ 마지막 갱신/저장.)
 * Google refresh_token 은 7일(미인증 앱) ~ 6개월(인증 앱) 미사용 시 revoke 됨.
 * auth_status 응답 enrichment 에 사용.
 */
export function getTokensLastRefreshMs(): number | null {
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
        ...(newTokens.scope && { scope: newTokens.scope }),
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
  options: { timeoutMs?: number; domains?: readonly AuthDomainId[] } = {},
): { url: string; wait: Promise<StoredTokens> } {
  if (activeAuthServer) {
    try { activeAuthServer.close(); } catch { /* noop */ }
    activeAuthServer = null;
  }

  saveCredentials(clientId, clientSecret);
  const oauth2Client = createOAuth2Client(clientId, clientSecret);
  const requestedScopes = scopesForDomains(options.domains);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: requestedScopes,
    // Private windows can still share cookies with an already-running private session.
    // Force Google to show the account chooser so an unrelated signed-in account is
    // never selected implicitly.
    prompt: 'consent select_account',
    include_granted_scopes: true,
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
        // scope 는 항상 기록한다 — 그리고 누적(monotonic)으로 저장한다.
        //   1) include_granted_scopes 로 Google 측 grant 는 (기존 부여분 ∪ 이번 요청분)이다.
        //   2) 응답의 tokens.scope 는 그 합집합이어야 하지만, 만약 Google 이 좁혀서 주거나
        //      생략하면(빈 값) 여기서 기존 기록 + 이번 요청 스코프로 보정한다.
        // 이렇게 해야 "scope 미기록 = 추적 이전 legacy 토큰" 불변식이 유지된다 — 도메인
        // 선택형 로그인이 이를 깨서, 좁은 로그인이 legacy 로 오인돼 pre-flight 를 우회하는
        // 것을 막는다. (기존엔 응답 scope 로 통째 덮어써서 이 두 위험에 모두 노출됐다.)
        const priorScope = getStoredTokens()?.scope;
        const stored: StoredTokens = {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_type: tokens.token_type ?? 'Bearer',
          expiry_date: tokens.expiry_date ?? Date.now() + 3600_000,
          scope: mergeScopeStrings(priorScope, tokens.scope ?? requestedScopes.join(' ')),
        };
        saveTokens(stored);

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
 * Interactive login — opens a private browser window, waits for callback.
 * startAuth() 래퍼 — CLI에서 사용.
 */
export async function login(
  clientId: string,
  clientSecret: string,
  options: { domains?: readonly AuthDomainId[] } = {},
): Promise<StoredTokens> {
  const { url, wait } = startAuth(clientId, clientSecret, options);
  console.log('🔐 시크릿 브라우저에서 Google 계정 선택 중...');
  await openPrivateBrowser(url);
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
/**
 * 사전 갱신 마진. 기존 60_000(1분)에서 300_000(5분)으로 상향 — Google OAuth access_token 의
 * 통상 lifetime 이 1h 이므로, 5분 마진으로 매 도구 호출 시 만료 임박 시 사전 갱신해
 * "토큰 만료 → 도구 fail → 재호출" 의 단절 마찰 제거. 5분 마진은 평균 도구 작업 시간을 흡수.
 */
export async function ensureFreshAccessToken(marginMs = 300_000): Promise<RefreshStatus> {
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

  // refresh 시도 — credentials.json(디스크) 우선. 디스크에 있으면 원격 조회 자체를 안 한다 —
  // 매시간 refresh 가 웹 콘솔 생존에 의존하면 콘솔 장애가 모든 로컬 도구 호출을 죽인다.
  // 없을 때만 env → 원격(getMcpOAuthClient) 순으로 받고, 성공 시 디스크에 저장해
  // 원격 의존을 최초 1회로 끝낸다. 조회 실패는 raw throw 가 아니라 분류된 에러로 반환.
  let clientId: string;
  let clientSecret: string;
  const stored = getStoredCredentials();
  if (stored?.clientId && stored?.clientSecret) {
    ({ clientId, clientSecret } = stored);
  } else {
    try {
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
      access_token: credentials.access_token ?? tokens.access_token,
      refresh_token: credentials.refresh_token ?? tokens.refresh_token,
      token_type: credentials.token_type ?? tokens.token_type ?? 'Bearer',
      expiry_date: credentials.expiry_date ?? Date.now() + 3600_000,
      // refresh 응답은 scope 를 생략할 수 있으므로 기존 값을 보존(blank 방지).
      scope: credentials.scope ?? tokens.scope,
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
