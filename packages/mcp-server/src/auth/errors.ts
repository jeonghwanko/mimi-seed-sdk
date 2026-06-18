// Auth 에러 코드 — CLI/MCP/스크립트 모두 같은 코드를 보고 분기할 수 있도록
// 단일 source of truth.

export type AuthErrorCode =
  // 토큰 상태
  | 'UNAUTHENTICATED' // tokens.json 없음
  | 'NO_REFRESH_TOKEN' // tokens.json은 있는데 refresh_token 누락 (offline_access 미발급)
  | 'INVALID_GRANT' // refresh_token revoke/expired — 사용자 재로그인 필요
  | 'RAPT_REQUIRED' // Google Workspace 재인증(reauth) 정책 — invalid_rapt
  | 'INVALID_CLIENT' // client_id/secret 불일치 — CLI 자체 문제
  | 'UNAUTHORIZED_CLIENT' // 동의 범위/리다이렉트 URI 불일치
  | 'REFRESH_NETWORK_ERROR' // 구글 토큰 엔드포인트 도달 실패
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
  message: string; // 사용자가 읽을 한국어 메시지
  hint?: string; // 다음 행동 제안
  retriable: boolean;
  needsReauth: boolean; // true면 mimi-seed-auth 재실행 필요
  cause?: string; // 원본 에러 message (디버깅용)
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
  const raw = describeError(e);
  const oauthCode = extractOAuthErrorCode(e, raw);

  // Google OAuth 표준 에러 코드 매핑
  if (oauthCode === 'invalid_grant') {
    return {
      code: 'INVALID_GRANT',
      message: 'refresh_token이 더 이상 유효하지 않습니다 (revoke 또는 만료).',
      hint: 'mimi-seed-auth 로 재로그인하세요.',
      retriable: false,
      needsReauth: true,
      cause: raw,
    };
  }
  if (oauthCode === 'invalid_rapt' || oauthCode === 'rapt_required') {
    return {
      code: 'RAPT_REQUIRED',
      message:
        'Google Workspace 재인증(reauth) 정책으로 토큰 갱신이 거부되었습니다 (invalid_rapt).',
      hint:
        'mimi-seed-auth 로 재로그인하거나, 재인증 정책의 영향을 받지 않는 서비스 계정 인증을 사용하세요 ' +
        '(BigQuery: mimi-seed-bigquery-auth).',
      retriable: false,
      needsReauth: true,
      cause: raw,
    };
  }
  if (oauthCode === 'invalid_client') {
    return {
      code: 'INVALID_CLIENT',
      message: 'OAuth client_id/secret이 토큰 발급 당시와 일치하지 않습니다.',
      hint:
        '일반적으로 발생하지 않음. 환경변수 MIMI_SEED_GOOGLE_CLIENT_ID/SECRET 오버라이드 사용 시 ' +
        '동일 값으로 다시 발급받으세요.',
      retriable: false,
      needsReauth: true,
      cause: raw,
    };
  }
  if (oauthCode === 'unauthorized_client') {
    return {
      code: 'UNAUTHORIZED_CLIENT',
      message: 'OAuth client에 부여되지 않은 grant_type 또는 scope입니다.',
      hint: 'mimi-seed-auth 로 새로운 동의를 받으세요.',
      retriable: false,
      needsReauth: true,
      cause: raw,
    };
  }
  if (oauthCode === 'access_denied') {
    return {
      code: 'USER_DENIED',
      message: '브라우저에서 Google 동의를 거부했습니다.',
      hint: '다시 시도하고 모든 권한에 동의해주세요.',
      retriable: true,
      needsReauth: true,
      cause: raw,
    };
  }

  // 네트워크 / 시스템 레벨
  if (isNetworkError(e, raw)) {
    return {
      code: 'REFRESH_NETWORK_ERROR',
      message: '구글 토큰 엔드포인트(oauth2.googleapis.com)에 연결할 수 없습니다.',
      hint: '인터넷 연결, 프록시, 방화벽을 확인하세요.',
      retriable: true,
      needsReauth: false,
      cause: raw,
    };
  }
  if (isPortInUseError(e, raw)) {
    return {
      code: 'CALLBACK_PORT_IN_USE',
      message: 'OAuth 콜백 포트 9876이 이미 사용 중입니다.',
      hint: '해당 포트를 점유 중인 프로세스를 종료하거나 잠시 후 다시 시도하세요.',
      retriable: true,
      needsReauth: false,
      cause: raw,
    };
  }
  if (/timeout/i.test(raw) && ctx.phase === 'login') {
    return {
      code: 'CALLBACK_TIMEOUT',
      message: '시간 내 Google 콜백을 받지 못했습니다.',
      hint:
        '브라우저에서 동의 안 하셨거나 자동 열기 실패. ' +
        '`mimi-seed-auth --no-browser`로 URL을 직접 받아 다른 환경에서 여세요.',
      retriable: true,
      needsReauth: false,
      cause: raw,
    };
  }

  // 분류 안 됨
  return {
    code: ctx.phase === 'refresh' ? 'REFRESH_UNKNOWN' : 'CODE_EXCHANGE_FAILED',
    message: '인증 처리 중 알 수 없는 오류가 발생했습니다.',
    hint: '재시도 후 동일하면 mimi-seed-auth 로 재로그인하세요.',
    retriable: true,
    needsReauth: ctx.phase === 'refresh',
    cause: raw,
  };
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
