// Auth 에러 코드 — CLI/MCP/스크립트 모두 같은 코드를 보고 분기할 수 있도록
// 단일 source of truth.

import { resolveLang } from '#core/lang.js';

export type AuthErrorCode =
  // 토큰 상태
  | 'UNAUTHENTICATED' // tokens.json 없음
  | 'NO_REFRESH_TOKEN' // tokens.json은 있는데 refresh_token 누락 (offline_access 미발급)
  | 'INVALID_GRANT' // refresh_token revoke/expired — 사용자 재로그인 필요
  | 'RAPT_REQUIRED' // Google Workspace 재인증(reauth) 정책 — invalid_rapt
  | 'INVALID_CLIENT' // client_id/secret 불일치 — CLI 자체 문제
  | 'UNAUTHORIZED_CLIENT' // 동의 범위/리다이렉트 URI 불일치
  | 'REFRESH_NETWORK_ERROR' // 구글 토큰 엔드포인트 도달 실패
  | 'CONFIG_FETCH_FAILED' // 웹 콘솔에서 OAuth client 설정을 못 받음 (mcp-auth-config)
  | 'REFRESH_UNKNOWN' // 분류 안 된 갱신 오류
  | 'INSUFFICIENT_SCOPE' // 토큰은 유효하나 도구가 요구하는 OAuth 스코프 미보유 (신규 스코프 추가 후 재로그인 전)
  // 로그인 플로우
  | 'CALLBACK_PORT_IN_USE' // 9876 점유
  | 'CALLBACK_TIMEOUT' // 사용자가 시간 내 승인 안 함
  | 'BROWSER_OPEN_FAILED' // open() 실패
  | 'USER_DENIED' // OAuth 동의 거부
  | 'CODE_EXCHANGE_FAILED' // code → token 교환 실패
  | 'TOKEN_RESPONSE_INVALID'; // 응답에서 access/refresh 누락

export interface AuthErrorPayload {
  code: AuthErrorCode;
  message: string; // 사용자가 읽을 메시지 — 생성 시점의 resolveLang() 언어 (authText())
  hint?: string; // 다음 행동 제안
  retriable: boolean;
  needsReauth: boolean; // true면 mimi-seed-auth 재실행 필요
  cause?: string; // 원본 에러 message (디버깅용)
}

/** 사용자에게 보여줄 메시지 한 쌍. */
interface AuthText {
  message: string;
  hint: string;
}

// 인증 에러 문구 — 사람이 터미널(mimi-seed-auth)·브라우저 콜백 페이지·MCP 클라이언트에서 그대로 읽는다.
// 도구 description 과 달리 "LLM 전용 인터페이스"가 아니라 사용자가 따라 해야 하는 복구 안내라서
// 언어를 고른다. ko 가 원본이고 en 은 `typeof ko` 를 만족해야 한다 — 키를 빠뜨리면 컴파일이 깨진다.
// code / retriable / needsReauth 는 언어와 무관하므로 여기 두지 않는다.
const ko = {
  invalidGrant: {
    message: 'refresh_token이 더 이상 유효하지 않습니다 (revoke 또는 만료).',
    hint: 'mimi-seed-auth 로 재로그인하세요.',
  },
  raptRequired: {
    message: 'Google Workspace 재인증(reauth) 정책으로 토큰 갱신이 거부되었습니다 (invalid_rapt).',
    hint:
      'mimi-seed-auth 로 재로그인하거나, 재인증 정책의 영향을 받지 않는 서비스 계정 인증을 사용하세요 ' +
      '(BigQuery: mimi-seed-bigquery-auth).',
  },
  invalidClient: {
    message: 'OAuth client_id/secret이 토큰 발급 당시와 일치하지 않습니다.',
    hint:
      '일반적으로 발생하지 않음. 환경변수 MIMI_SEED_GOOGLE_CLIENT_ID/SECRET 오버라이드 사용 시 ' +
      '동일 값으로 다시 발급받으세요.',
  },
  unauthorizedClient: {
    message: 'OAuth client에 부여되지 않은 grant_type 또는 scope입니다.',
    hint: 'mimi-seed-auth 로 새로운 동의를 받으세요.',
  },
  userDenied: {
    message: 'Google 동의가 거부되었습니다 (access_denied).',
    hint:
      '직접 거부하지 않았다면: 이 OAuth 앱은 Google 미검증(테스트) 상태라 등록된 테스트 사용자만 로그인할 수 있습니다. ' +
      '운영자에게 Google Cloud Console → OAuth 동의 화면 → 테스트 사용자에 이 계정 추가를 요청한 뒤 재시도하세요. ' +
      '직접 거부했다면 다시 시도해 모든 권한에 동의해주세요.',
  },
  configFetchFailed: {
    message: '사용할 Google OAuth 클라이언트 설정이 없습니다.',
    hint:
      'Google 데스크톱 앱용 OAuth 클라이언트를 만든 뒤 ' +
      '환경변수 MIMI_SEED_GOOGLE_CLIENT_ID / MIMI_SEED_GOOGLE_CLIENT_SECRET 로 자체 OAuth 클라이언트를 지정하세요.',
  },
  networkError: {
    message: '구글 토큰 엔드포인트(oauth2.googleapis.com)에 연결할 수 없습니다.',
    hint: '인터넷 연결, 프록시, 방화벽을 확인하세요.',
  },
  portInUse: {
    message: 'OAuth 콜백 포트 9876이 이미 사용 중입니다.',
    hint: '해당 포트를 점유 중인 프로세스를 종료하거나 잠시 후 다시 시도하세요.',
  },
  callbackTimeout: {
    message: '시간 내 Google 콜백을 받지 못했습니다.',
    hint:
      '브라우저에서 동의 안 하셨거나 자동 열기 실패. ' +
      '`mimi-seed-auth --no-browser`로 URL을 직접 받아 다른 환경에서 여세요.',
  },
  unknown: {
    message: '인증 처리 중 알 수 없는 오류가 발생했습니다.',
    hint: '재시도 후 동일하면 mimi-seed-auth 로 재로그인하세요.',
  },
  unauthenticated: {
    message: '저장된 인증 토큰이 없습니다.',
    hint: 'mimi-seed-auth 로 로그인하세요.',
  },
  tokenFileInvalid: (file: string, reason: string): AuthText => ({
    message: `저장된 인증 토큰 파일을 읽을 수 없습니다: ${file} (${reason}).`,
    hint: 'mimi-seed-auth 로 다시 로그인하면 파일을 새로 씁니다.',
  }),
  noRefreshToken: {
    message: '저장된 토큰에 refresh_token이 없습니다 (offline_access 미발급).',
    hint: 'mimi-seed-auth 로 재로그인하면 prompt=consent로 새 refresh_token이 발급됩니다.',
  },
  tokenResponseInvalid: {
    message: 'Google 응답에 access_token 또는 refresh_token이 누락되었습니다.',
    hint: 'OAuth 동의 화면에서 모든 권한에 동의했는지 확인하세요.',
  },
  callbackAddressInUse: (address: string, port: number): AuthText => ({
    message: `OAuth 콜백 주소 ${address} 를 다른 프로세스가 사용 중입니다.`,
    hint:
      `localhost 는 127.0.0.1 과 ::1 어느 쪽으로도 풀릴 수 있어 로그인은 두 주소의 ${port} 포트를 모두 엽니다. ` +
      `점유 프로세스를 찾아 종료한 뒤 다시 시도하세요 — macOS/Linux: \`lsof -nP -i :${port}\`, ` +
      `Windows: \`netstat -ano | findstr :${port}\`. 중단된 이전 로그인이면 잠시 후 재시도해도 됩니다.`,
  }),
  insufficientScope: (scopes: readonly string[]): AuthText => ({
    message: `이 도구는 추가 권한이 필요해 (${scopes.join(' 또는 ')}). 현재 로그인에 그 권한이 없어.`,
    hint: '아래 명령으로 로그인하면 기존 권한을 유지하면서 필요한 권한을 추가할 수 있어.',
  }),
  /** MCP 응답에서 재로그인 명령 앞에 붙는 줄. */
  reloginInTerminal: '터미널에서 재로그인:',
  /** OAuth 콜백 성공 시 브라우저에 뜨는 페이지. */
  callbackPage: {
    lang: 'ko',
    title: '✅ Mimi Seed 인증 완료!',
    body: '이 창을 닫고 Claude Code 또는 Codex로 돌아가세요.',
  },
};

const en: typeof ko = {
  invalidGrant: {
    message: 'The refresh_token is no longer valid (revoked or expired).',
    hint: 'Log in again with mimi-seed-auth.',
  },
  raptRequired: {
    message: 'A Google Workspace reauthentication policy rejected the token refresh (invalid_rapt).',
    hint:
      'Log in again with mimi-seed-auth, or use service-account auth, which the reauth policy does not affect ' +
      '(BigQuery: mimi-seed-bigquery-auth).',
  },
  invalidClient: {
    message: 'The OAuth client_id/secret does not match the one the token was issued to.',
    hint:
      'This normally does not happen. If you override MIMI_SEED_GOOGLE_CLIENT_ID/SECRET, ' +
      'log in again with the same values.',
  },
  unauthorizedClient: {
    message: 'The OAuth client is not allowed this grant_type or scope.',
    hint: 'Grant consent again with mimi-seed-auth.',
  },
  userDenied: {
    message: 'Google consent was denied (access_denied).',
    hint:
      'If you did not deny it yourself: this OAuth app is unverified (testing) on Google, so only registered test users can log in. ' +
      'Ask the operator to add this account under Google Cloud Console → OAuth consent screen → Test users, then retry. ' +
      'If you denied it, try again and accept every permission.',
  },
  configFetchFailed: {
    message: 'Google OAuth client configuration is unavailable.',
    hint:
      'Set your Google Desktop app OAuth client with ' +
      'MIMI_SEED_GOOGLE_CLIENT_ID / MIMI_SEED_GOOGLE_CLIENT_SECRET.',
  },
  networkError: {
    message: 'Cannot reach the Google token endpoint (oauth2.googleapis.com).',
    hint: 'Check your internet connection, proxy, and firewall.',
  },
  portInUse: {
    message: 'OAuth callback port 9876 is already in use.',
    hint: 'Stop the process holding the port, or wait a moment and retry.',
  },
  callbackTimeout: {
    message: 'Did not receive the Google callback in time.',
    hint:
      'Consent was not given in the browser, or the browser failed to open. ' +
      'Use `mimi-seed-auth --no-browser` to get the URL and open it elsewhere.',
  },
  unknown: {
    message: 'An unknown error occurred during authentication.',
    hint: 'Retry; if it keeps failing, log in again with mimi-seed-auth.',
  },
  unauthenticated: {
    message: 'No stored auth token.',
    hint: 'Log in with mimi-seed-auth.',
  },
  tokenFileInvalid: (file: string, reason: string): AuthText => ({
    message: `The stored auth token file cannot be read: ${file} (${reason}).`,
    hint: 'Log in again with mimi-seed-auth; it rewrites the file.',
  }),
  noRefreshToken: {
    message: 'The stored token has no refresh_token (offline_access was not granted).',
    hint: 'Log in again with mimi-seed-auth; prompt=consent issues a new refresh_token.',
  },
  tokenResponseInvalid: {
    message: 'Google’s response is missing access_token or refresh_token.',
    hint: 'Make sure you accepted every permission on the OAuth consent screen.',
  },
  callbackAddressInUse: (address: string, port: number): AuthText => ({
    message: `The OAuth callback address ${address} is already in use by another process.`,
    hint:
      `Login listens on port ${port} on both 127.0.0.1 and ::1 because localhost can resolve to either. ` +
      `Find and stop the process holding it — macOS/Linux: \`lsof -nP -i :${port}\`, ` +
      `Windows: \`netstat -ano | findstr :${port}\` — or wait for an abandoned earlier login to time out, then retry.`,
  }),
  insufficientScope: (scopes: readonly string[]): AuthText => ({
    message: `This tool needs an additional permission (${scopes.join(' or ')}) that the current login does not have.`,
    hint: 'Log in with the command below to add it while keeping your existing permissions.',
  }),
  reloginInTerminal: 'Log in again from a terminal:',
  callbackPage: {
    lang: 'en',
    title: '✅ Mimi Seed authentication complete!',
    body: 'Close this window and return to Claude Code or Codex.',
  },
};

/**
 * 현재 언어의 인증 문구. 호출 시점에 언어를 읽는다(모듈 로드 시점이 아니라) — MIMI_SEED_LANG 이나
 * settings.json 이 바뀌면 다음 에러부터 반영된다.
 */
export function authText(): typeof ko {
  return resolveLang() === 'en' ? en : ko;
}

export class AuthError extends Error {
  constructor(public payload: AuthErrorPayload) {
    super(`[${payload.code}] ${payload.message}`);
    this.name = 'AuthError';
  }
}

interface ClassifyContext {
  phase: 'refresh' | 'login';
}

/**
 * 임의의 에러 객체를 AuthErrorPayload로 분류.
 * Google OAuth 응답 형태:
 *   { error: 'invalid_grant', error_description: '...' }
 * googleapis 라이브러리는 e.response?.data?.error 또는 e.message에 코드 포함.
 */
export function classifyError(e: unknown, ctx: ClassifyContext): AuthErrorPayload {
  // 이미 분류된 에러는 그대로 — 다시 분류하면 메시지 텍스트(언어마다 다름)를 정규식으로 재해석하게 되어
  // 원래 code 를 잃는다 (예: 한국어 CALLBACK_PORT_IN_USE 문구는 'already in use' 를 담지 않는다).
  if (e instanceof AuthError) return e.payload;
  const raw = describeError(e);
  const oauthCode = extractOAuthErrorCode(e, raw);
  const T = authText();
  const make = (
    code: AuthErrorCode,
    text: AuthText,
    flags: { retriable: boolean; needsReauth: boolean },
  ): AuthErrorPayload => ({ code, ...text, ...flags, cause: raw });

  // Google OAuth 표준 에러 코드 매핑
  if (oauthCode === 'invalid_grant') {
    return make('INVALID_GRANT', T.invalidGrant, { retriable: false, needsReauth: true });
  }
  if (oauthCode === 'invalid_rapt' || oauthCode === 'rapt_required') {
    return make('RAPT_REQUIRED', T.raptRequired, { retriable: false, needsReauth: true });
  }
  if (oauthCode === 'invalid_client') {
    return make('INVALID_CLIENT', T.invalidClient, { retriable: false, needsReauth: true });
  }
  if (oauthCode === 'unauthorized_client') {
    return make('UNAUTHORIZED_CLIENT', T.unauthorizedClient, { retriable: false, needsReauth: true });
  }
  if (oauthCode === 'access_denied') {
    return make('USER_DENIED', T.userDenied, { retriable: true, needsReauth: true });
  }

  // OAuth client 설정 조회 실패 — 구글이 아니라 mimi-seed 웹 콘솔 쪽 문제.
  // 네트워크 분류보다 먼저 검사해야 "oauth2.googleapis.com 연결 실패" 오진을 막는다.
  if (/mcp-auth-config/i.test(raw)) {
    return make('CONFIG_FETCH_FAILED', T.configFetchFailed, { retriable: true, needsReauth: false });
  }

  // 네트워크 / 시스템 레벨
  if (isNetworkError(e, raw)) {
    return make('REFRESH_NETWORK_ERROR', T.networkError, { retriable: true, needsReauth: false });
  }
  if (isPortInUseError(e, raw)) {
    return make('CALLBACK_PORT_IN_USE', T.portInUse, { retriable: true, needsReauth: false });
  }
  if (/timeout/i.test(raw) && ctx.phase === 'login') {
    return make('CALLBACK_TIMEOUT', T.callbackTimeout, { retriable: true, needsReauth: false });
  }

  // 분류 안 됨
  return make(
    ctx.phase === 'refresh' ? 'REFRESH_UNKNOWN' : 'CODE_EXCHANGE_FAILED',
    T.unknown,
    { retriable: true, needsReauth: ctx.phase === 'refresh' },
  );
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/**
 * googleapis OAuth 에러는 다양한 위치에 코드가 박혀 있다:
 *   - e.response?.data?.error
 *   - e.response?.data?.error_description
 *   - e.message (e.g. "invalid_grant")
 *   - e.code (네트워크: 'ENOTFOUND', 'ECONNREFUSED')
 */
function extractOAuthErrorCode(e: unknown, raw: string): string | undefined {
  if (e && typeof e === 'object') {
    // @ts-expect-error — 런타임 shape 검사
    const dataErr = e.response?.data?.error;
    if (typeof dataErr === 'string') return dataErr;
  }
  // message에 'invalid_grant' 같은 표준 코드가 박혀 있는 경우
  const m = raw.match(/\b(invalid_grant|invalid_client|invalid_request|unauthorized_client|access_denied|unsupported_grant_type|invalid_rapt|rapt_required)\b/);
  return m?.[1];
}

function isNetworkError(e: unknown, raw: string): boolean {
  if (e && typeof e === 'object') {
    // @ts-expect-error — runtime shape 검사
    const code: unknown = e.code;
    if (typeof code === 'string' && /^(ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET)$/.test(code)) {
      return true;
    }
  }
  return /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo|network/i.test(raw);
}

function isPortInUseError(e: unknown, raw: string): boolean {
  if (e && typeof e === 'object') {
    // @ts-expect-error — runtime shape 검사
    const code: unknown = e.code;
    if (code === 'EADDRINUSE') return true;
  }
  return /EADDRINUSE|address already in use|포트 9876/i.test(raw);
}
