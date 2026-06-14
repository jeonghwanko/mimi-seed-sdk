// Google Play (Android Publisher / Developer Reporting) 에러 친절화.
// App Store 의 friendlyAppStoreError 와 대칭 — Play 쪽엔 없던 친절화 레이어.
// 신규 사용자가 가장 자주 막히는 두 케이스(서비스 계정 권한 403, edit 세션 충돌)에
// 구체적 복구 단계를 붙인다. 인식 못 한 에러(도메인 에러 포함)는 원본 보존.

import { extractHttpStatus, authReauthMessage, withCause } from '../lib/google-errors.js';

// playstore_verify_service_account 의 403 안내와 동일한 체크리스트.
const PERMISSION_403 = [
  '❌ Google Play 권한 부족 (403).',
  '원인: 인증은 됐지만 Play Console에서 이 계정/서비스 계정에 권한이 없어요.',
  '',
  '1. Play Console → 사용자 및 권한(Users and permissions)',
  '2. 이 Google 계정(또는 서비스 계정 이메일)을 초대 / 권한 부여',
  '3. 앱 권한에 "앱 정보 관리" (재무 데이터 필요 시 "재무 데이터 보기") 부여',
  '4. 권한 적용까지 ~5분 대기 후 재시도 (너무 빨리 시도하면 계속 403)',
].join('\n');

export function friendlyPlayError(e: unknown, packageName?: string): Error {
  const text = e instanceof Error ? e.message : String(e);
  const status = extractHttpStatus(e);

  const reauth = authReauthMessage(text);
  if (reauth) return withCause(new Error(reauth), e);

  if (status === 403 || /PERMISSION_DENIED|insufficient permission|forbidden/i.test(text)) {
    return withCause(new Error(PERMISSION_403), e);
  }
  if (status === 404 || /NOT_FOUND|not found/i.test(text)) {
    return withCause(
      new Error(
        `❌ 패키지${packageName ? ` (${packageName})` : ''}를 이 개발자 계정에서 찾을 수 없어요.\n→ packageName 철자와 계정 권한을 확인하세요.`,
      ),
      e,
    );
  }
  if (/This Edit has been deleted|editAlreadyCommitted|edit.*(deleted|expired|not found)/i.test(text)) {
    return withCause(
      new Error(
        '❌ Play edit 세션 충돌 — 같은 요청에서 edit 세션을 여러 번 열었을 수 있어요.\n→ 작업을 하나의 withEdit 트랜잭션으로 묶고, 잠시 후 재시도하세요.',
      ),
      e,
    );
  }
  // 인식 못 한 에러(이미 친절한 도메인 에러 포함)는 원본 보존
  return e instanceof Error ? e : new Error(text);
}
