import { getAuthenticatedClient, ensureFreshAccessToken } from './auth/google-auth.js';
import { domainsForScope, isPreTrackingScope } from './auth/scopes.js';
import { getServiceAccountClient, getServiceAccountJson } from './auth/playstore-auth.js';
import { appStoreCredentialsPath, getAppStoreCredentials } from './appstore/auth.js';
import { authText, type AuthErrorPayload } from './auth/errors.js';
import { assertCredentialFileReadable } from './lib/json-file.js';
import { catalog } from '#core/lang.js';

export { ensureFreshAccessToken };

const REAUTH_CMD = '  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth';

function formatAuthError(p: AuthErrorPayload, profile?: string, scopes: readonly string[] = []): string {
  // Scope alternatives are ordered by the caller. Recommend the first available domain.
  const domain = scopes.flatMap(domainsForScope)[0];
  const reauthCommand = [
    REAUTH_CMD,
    profile === undefined ? '' : ` --profile ${profile}`,
    domain ? ` --domains ${domain}` : '',
  ].join('');
  // 재로그인 안내는 needsReauth 인 경우에만 — CONFIG_FETCH_FAILED 처럼 재로그인이
  // 해법이 아닌 에러에 무조건 붙이면 같은 실패를 반복하게 만든다.
  return [
    `❌ [${p.code}] ${p.message}`,
    p.hint ? `→ ${p.hint}` : '',
    ...(p.needsReauth ? ['', authText().reloginInTerminal, reauthCommand] : []),
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/**
 * 도구가 요구하는 스코프의 pre-flight 검사. expiry 만 보는 ensureFreshAccessToken 은
 * 스코프 미보유를 못 걸러내므로(런타임 ACCESS_TOKEN_SCOPE_INSUFFICIENT), 저장된 scope 로
 * 결정적인 안내를 던진다. 도메인 선택형 로그인 도입 후에는 "전체 재로그인"이 아니라
 * "--domains <해당 도메인> 으로 추가 부여(기존 권한 유지)"가 올바른 해법이다.
 *
 * scope 가 undefined 인 구 토큰(스코프 추적 도입 전 full-scope 로그인)은 추적 도입
 * 이전부터 있던 스코프는 보유한 게 확실하므로 통과시킨다 — 안 그러면 pre-flight 를 새로
 * 다는 순간 멀쩡한 기존 사용자에게 재로그인을 강제한다. 추적 이후 추가된 스코프(GA4,
 * Play Developer Reporting)만 미보유 확정으로 본다.
 *
 * OAuth 토큰에만 적용된다 — SA JWT 는 자체 scopes 로 토큰을 받으므로 이 검사 대상이 아니다.
 */
function assertStoredScope(scopes: readonly string[], scopeStr: string | undefined, profile?: string): void {
  if (scopes.length === 0) return;
  const grantedScopes = scopeStr?.split(/\s+/);
  if (scopes.some((scope) => grantedScopes ? grantedScopes.includes(scope) : isPreTrackingScope(scope))) return;
  throw new Error(
    formatAuthError({
      code: 'INSUFFICIENT_SCOPE',
      ...authText().insufficientScope(scopes),
      retriable: false,
      needsReauth: true,
    }, profile, scopes),
  );
}

/**
 * OAuth 클라이언트 확보 — 호출 전에 access_token 을 사전 갱신하고,
 * refresh_token 이 만료/누락이면 raw googleapis 에러(invalid_grant 등) 대신
 * 친절한 재로그인 안내를 던진다.
 *
 * 기존엔 만료 시 각 OAuth 도구(firebase/admob/iam/googleads/checks)가
 * googleapis GaxiosError 를 그대로 노출 → 사용자는 "재로그인하라"는 안내를 못 받았다.
 * 스코프 배열을 넘기면 그중 하나만 부여되어 있어도 통과한다.
 */
export async function requireAuth(requiredScope?: string | readonly string[], profile?: string) {
  const scopes = typeof requiredScope === 'string' ? [requiredScope] : requiredScope ?? [];
  const result = await ensureFreshAccessToken(undefined, profile);
  if (result.status === 'unauthenticated' || result.status === 'expired_refresh_failed') {
    throw new Error(formatAuthError(result.error, profile, scopes));
  }
  const client = getAuthenticatedClient(profile, result.tokens);
  if (!client) {
    throw new Error(
      formatAuthError({
        code: 'UNAUTHENTICATED',
        ...H().googleNotConnected,
        retriable: false,
        needsReauth: true,
      }, profile, scopes),
    );
  }
  // 같은 토큰으로 인증 클라이언트를 만든 뒤 해당 토큰의 스코프를 검사한다.
  assertStoredScope(scopes, result.tokens.scope, profile);
  return client;
}

/** 인증 안내 — LLM 이 사용자에게 전하는 복구 절차라 언어를 따른다 (호출 시점에 언어를 읽는다). */
const H = catalog(
  {
    googleNotConnected: { message: 'Google 계정이 연결되지 않았어.', hint: 'mimi-seed-auth 로 로그인하세요.' },
    play: [
      '❌ Google Play 인증이 없어.',
      '',
      '가장 쉬운 방법 — Google 로그인 (androidpublisher 권한 포함):',
      REAUTH_CMD,
      '',
      '또는 서버/헤드리스 환경이면 서비스 계정 JSON 등록:',
      '  npx -y @yoonion/mimi-seed-mcp mimi-seed-playstore-auth',
      '',
      '그 다음에 다시 물어봐줘.',
    ],
    appstore: [
      '❌ App Store Connect 인증이 설정되지 않았어.',
      '',
      '터미널에서 이것만 실행하면 돼:',
      '',
      '  npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
      '',
      'Issuer ID, Key ID, .p8 파일 경로를 입력하면 저장 완료.',
      '그 다음에 다시 물어봐줘.',
    ],
  },
  {
    googleNotConnected: { message: 'No Google account is connected.', hint: 'Log in with mimi-seed-auth.' },
    play: [
      '❌ No Google Play authentication.',
      '',
      'Easiest — Google login (includes the androidpublisher permission):',
      REAUTH_CMD,
      '',
      'Or, on a server/headless environment, register a service account JSON:',
      '  npx -y @yoonion/mimi-seed-mcp mimi-seed-playstore-auth',
      '',
      'Then ask again.',
    ],
    appstore: [
      '❌ App Store Connect authentication is not set up.',
      '',
      'Run just this in a terminal:',
      '',
      '  npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
      '',
      'Enter the Issuer ID, Key ID, and .p8 file path to save it.',
      'Then ask again.',
    ],
  },
);

/** Google Play 인증이 없을 때의 안내 (현재 언어). */
export const playAuthHint = (): string => H().play.join('\n');
/** App Store Connect 인증이 없을 때의 안내 (현재 언어). */
export const appStoreAuthHint = (): string => H().appstore.join('\n');

/**
 * Google Play 인증 — 서비스 계정 JSON 우선, 없으면 OAuth 클라이언트로 폴백.
 *
 * 로그인(mimi-seed-auth) 시 androidpublisher scope 를 이미 부여받으므로,
 * 별도 서비스 계정 JSON 을 받지 않아도 대부분의 Play 작업이 가능하다.
 * (서비스 계정은 서버/헤드리스 — onesub 영수증 검증 등 — 용도로 계속 우선 적용.)
 */
export async function requirePlayStoreAuth(packageName?: string, requiredScope?: string) {
  const sa = getServiceAccountClient(packageName);
  if (sa) return sa;
  // OAuth 폴백도 requireAuth 와 같이 사전 갱신한다 — 안 그러면 refresh_token 이 폐기됐을 때
  // 재로그인 안내 대신 googleapis 의 raw invalid_grant 가 그대로 노출된다.
  const result = await ensureFreshAccessToken();
  if (result.status === 'unauthenticated') throw new Error(playAuthHint());
  if (result.status === 'expired_refresh_failed') throw new Error(formatAuthError(result.error));
  const oauth = getAuthenticatedClient();
  if (!oauth) throw new Error(playAuthHint());
  // OAuth 폴백일 때만 스코프 pre-flight — SA JWT 는 자체 scopes 로 토큰을 받으므로
  // (getServiceAccountClient 가 reporting 스코프를 이미 싣는다) 해당 없음.
  assertStoredScope(requiredScope ? [requiredScope] : [], result.tokens.scope);
  return oauth;
}

export function requireServiceAccountJson(packageName?: string): string {
  const json = getServiceAccountJson(packageName);
  if (!json) throw new Error(playAuthHint());
  return json;
}

export function requireAppStoreCreds() {
  const creds = getAppStoreCredentials();
  if (!creds) {
    assertCredentialFileReadable(appStoreCredentialsPath(), 'npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth');
    throw new Error(appStoreAuthHint());
  }
  return creds;
}
