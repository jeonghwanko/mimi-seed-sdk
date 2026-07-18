import { getAuthenticatedClient, ensureFreshAccessToken, getStoredTokens } from './auth/google-auth.js';
import { domainsForScope, isPreTrackingScope } from './auth/scopes.js';
import { getServiceAccountClient, getServiceAccountJson } from './auth/playstore-auth.js';
import { getAppStoreCredentials } from './appstore/auth.js';
import type { AuthErrorPayload } from './auth/errors.js';

export { ensureFreshAccessToken };

const REAUTH_CMD = '  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth';

function formatAuthError(p: AuthErrorPayload): string {
  // 재로그인 안내는 needsReauth 인 경우에만 — CONFIG_FETCH_FAILED 처럼 재로그인이
  // 해법이 아닌 에러에 무조건 붙이면 같은 실패를 반복하게 만든다.
  return [
    `❌ [${p.code}] ${p.message}`,
    p.hint ? `→ ${p.hint}` : '',
    ...(p.needsReauth ? ['', '터미널에서 재로그인:', REAUTH_CMD] : []),
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/**
 * OAuth 클라이언트 확보 — 호출 전에 access_token 을 사전 갱신하고,
 * refresh_token 이 만료/누락이면 raw googleapis 에러(invalid_grant 등) 대신
 * 친절한 재로그인 안내를 던진다.
 *
 * 기존엔 만료 시 각 OAuth 도구(firebase/admob/iam/googleads/checks)가
 * googleapis GaxiosError 를 그대로 노출 → 사용자는 "재로그인하라"는 안내를 못 받았다.
 */
export async function requireAuth(requiredScope?: string) {
  const result = await ensureFreshAccessToken();
  if (result.status === 'unauthenticated' || result.status === 'expired_refresh_failed') {
    throw new Error(formatAuthError(result.error));
  }
  const client = getAuthenticatedClient();
  if (!client) {
    throw new Error(
      formatAuthError({
        code: 'UNAUTHENTICATED',
        message: 'Google 계정이 연결되지 않았어.',
        hint: 'mimi-seed-auth 로 로그인하세요.',
        retriable: false,
        needsReauth: true,
      }),
    );
  }
  // 도구가 요구하는 스코프의 pre-flight 검사. expiry 만 보는 ensureFreshAccessToken 은
  // 스코프 미보유를 못 걸러내므로(런타임 ACCESS_TOKEN_SCOPE_INSUFFICIENT), 저장된 scope 로
  // 결정적인 안내를 던진다. 도메인 선택형 로그인 도입 후에는 "전체 재로그인"이 아니라
  // "--domains <해당 도메인> 으로 추가 부여(기존 권한 유지)"가 올바른 해법이다.
  //
  // scope 가 undefined 인 구 토큰(스코프 추적 도입 전 full-scope 로그인)은 추적 도입
  // 이전부터 있던 스코프는 보유한 게 확실하므로 통과시킨다 — 안 그러면 pre-flight 를 새로
  // 다는 순간 멀쩡한 기존 사용자에게 재로그인을 강제한다. 추적 이후 추가된 스코프(GA4)만
  // 미보유 확정으로 본다.
  if (requiredScope) {
    const scopeStr = getStoredTokens()?.scope;
    const missing =
      scopeStr === undefined
        ? !isPreTrackingScope(requiredScope)
        : !scopeStr.split(' ').filter(Boolean).includes(requiredScope);
    if (missing) {
      const domainArg = domainsForScope(requiredScope).join(',');
      throw new Error(
        formatAuthError({
          code: 'INSUFFICIENT_SCOPE',
          message: `이 도구는 추가 권한이 필요해 (${requiredScope}). 현재 로그인에 그 권한이 없어.`,
          hint: domainArg
            ? `mimi-seed-auth --domains ${domainArg} 로 재로그인하면 기존 권한은 유지한 채 이 권한만 추가돼.`
            : 'mimi-seed-auth 로 재로그인하면 새 권한이 부여돼.',
          retriable: false,
          needsReauth: true,
        }),
      );
    }
  }
  return client;
}

export const PLAY_AUTH_HINT = [
  '❌ Google Play 인증이 없어.',
  '',
  '가장 쉬운 방법 — Google 로그인 (androidpublisher 권한 포함):',
  REAUTH_CMD,
  '',
  '또는 서버/헤드리스 환경이면 서비스 계정 JSON 등록:',
  '  npx -y @yoonion/mimi-seed-mcp mimi-seed-playstore-auth',
  '',
  '그 다음에 다시 물어봐줘.',
].join('\n');

export const APPSTORE_AUTH_HINT = [
  '❌ App Store Connect 인증이 설정되지 않았어.',
  '',
  '터미널에서 이것만 실행하면 돼:',
  '',
  '  npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
  '',
  'Issuer ID, Key ID, .p8 파일 경로를 입력하면 저장 완료.',
  '그 다음에 다시 물어봐줘.',
].join('\n');

/**
 * Google Play 인증 — 서비스 계정 JSON 우선, 없으면 OAuth 클라이언트로 폴백.
 *
 * 로그인(mimi-seed-auth) 시 androidpublisher scope 를 이미 부여받으므로,
 * 별도 서비스 계정 JSON 을 받지 않아도 대부분의 Play 작업이 가능하다.
 * (서비스 계정은 서버/헤드리스 — onesub 영수증 검증 등 — 용도로 계속 우선 적용.)
 */
export function requirePlayStoreAuth(packageName?: string) {
  const sa = getServiceAccountClient(packageName);
  if (sa) return sa;
  const oauth = getAuthenticatedClient();
  if (oauth) return oauth;
  throw new Error(PLAY_AUTH_HINT);
}

export function requireServiceAccountJson(packageName?: string): string {
  const json = getServiceAccountJson(packageName);
  if (!json) throw new Error(PLAY_AUTH_HINT);
  return json;
}

export function requireAppStoreCreds() {
  const creds = getAppStoreCredentials();
  if (!creds) throw new Error(APPSTORE_AUTH_HINT);
  return creds;
}
