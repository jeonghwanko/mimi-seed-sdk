import { google } from '../lib/googleapis-lite.js';
import type { OAuth2Client, JWT } from 'google-auth-library';
import { guardDotSegmentParams } from '../lib/resource-id.js';
import { GOOGLEAPIS_COMMIT_OPTIONS } from '../lib/google-timeouts.js';

/**
 * Google Play Developer API (Android Publisher API v3) 래퍼
 *
 * 주의: 최초 앱 생성은 API로 불가 (Play Console에서만).
 * 여기서는 기존 앱의 메타데이터, 빌드, 출시를 관리.
 */

// 모든 호출에서 경로 파라미터가 정확히 '.'/'..' 이면 요청 전에 거부 (lib/resource-id.ts).
export const publisher = () => guardDotSegmentParams(google.androidpublisher('v3'));

export interface EditCommitInfo {
  /** true 면 커밋은 됐지만 심사 전송은 Play Console 에서 사람이 눌러야 한다. */
  changesNotSentForReview: boolean;
}

// Play 는 앱/계정 상태에 따라 "커밋과 동시에 심사 전송"을 거부한다:
//   Changes cannot be sent for review automatically.
//   Please set the query parameter changesNotSentForReview to true.
// 이 경우 그 파라미터를 붙여야만 커밋이 통과한다. 예전 구현은 파라미터를 노출하지도,
// 폴백하지도 않아서 그런 앱에서는 promote/submit 계열이 **100% 실패**했다
// (실앱 2026-07-25 실측 — 결국 Android Publisher API 를 직접 쳐서 우회해야 했다).
async function commitEdit(
  auth: OAuth2Client | JWT,
  packageName: string,
  editId: string,
): Promise<EditCommitInfo> {
  try {
    await publisher().edits.commit({ auth, packageName, editId }, GOOGLEAPIS_COMMIT_OPTIONS);
    return { changesNotSentForReview: false };
  } catch (err) {
    const msg = String((err as { message?: string })?.message ?? err);
    if (!/changesNotSentForReview/i.test(msg)) throw err;
    await publisher().edits.commit({ auth, packageName, editId, changesNotSentForReview: true }, GOOGLEAPIS_COMMIT_OPTIONS);
    return { changesNotSentForReview: true };
  }
}

export async function withEdit<T>(
  auth: OAuth2Client | JWT,
  packageName: string,
  fn: (editId: string) => Promise<T>,
  commit = false,
  onCommit?: (info: EditCommitInfo) => void,
): Promise<T> {
  const res = await publisher().edits.insert({ auth, packageName });
  const editId = res.data.id;
  if (!editId) throw new Error('Failed to create edit session');
  try {
    const result = await fn(editId);
    if (commit) {
      // 반드시 먼저 커밋하고 나서 콜백에 넘긴다.
      // onCommit?.(await commitEdit(...)) 로 쓰면 안 된다 — 옵셔널 호출은 수신자가
      // nullish 일 때 인자 자체를 평가하지 않아서, onCommit 을 안 넘긴 호출자(대부분)에서
      // 커밋이 통째로 사라진다. playstore-listing 테스트가 이걸 잡아냈다.
      const info = await commitEdit(auth, packageName, editId);
      onCommit?.(info);
    }
    return result;
  } finally {
    if (!commit) {
      await publisher().edits.delete({ auth, packageName, editId }).catch(() => {});
    }
  }
}
