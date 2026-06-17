// Google Play (Android Publisher / Developer Reporting) 에러 친절화.
// App Store 의 friendlyAppStoreError 와 대칭 — Play 쪽엔 없던 친절화 레이어.
// 신규 사용자가 가장 자주 막히는 두 케이스(서비스 계정 권한 403, edit 세션 충돌)에
// 구체적 복구 단계를 붙인다. 인식 못 한 에러(도메인 에러 포함)는 원본 보존.

import { extractHttpStatus, authReauthMessage, withCause, googleErrorDetail } from '../lib/google-errors.js';

// 403 안내. raw Google 사유를 먼저 보여주고, 권한이 멀쩡한데 특정 작업만 거부되는
// 케이스(같은 SA로 이미지 업로드는 되는데 listings.update만 403 등)를 위해
// "다른 쓰기가 되면 권한 문제가 아니다"라는 단서를 붙인다. detail 은 googleErrorDetail() 결과.
function permission403Message(detail?: string): string {
  return [
    '❌ Google Play 403 — 요청이 거부됐어요.',
    detail ? `Google 사유: ${detail}` : '',
    '⚠️ 같은 계정/서비스 계정으로 다른 쓰기(예: 이미지 업로드)가 된다면 권한 문제가 아닐 수 있어요 — 위 Google 사유 또는 앱 상태·정책·작업별 제한을 먼저 확인하세요.',
    '',
    '정말 권한 문제라면:',
    '1. Play Console → 사용자 및 권한(Users and permissions)',
    '2. 이 Google 계정(또는 서비스 계정 이메일)을 초대 / 권한 부여',
    '3. 앱 권한에 "앱 정보 관리"(Manage store presence) 부여',
    '4. 권한 적용까지 ~5분 대기 후 재시도',
  ].filter((l) => l !== '').join('\n');
}

export function friendlyPlayError(e: unknown, packageName?: string): Error {
  const text = e instanceof Error ? e.message : String(e);
  const status = extractHttpStatus(e);

  const reauth = authReauthMessage(text);
  if (reauth) return withCause(new Error(reauth), e);

  if (status === 403 || /PERMISSION_DENIED|insufficient permission|forbidden/i.test(text)) {
    return withCause(new Error(permission403Message(googleErrorDetail(e))), e);
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
