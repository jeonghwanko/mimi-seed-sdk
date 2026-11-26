/** Play register 모듈들이 공유하는 것 — 친절 에러 프록시와 목록 잘림 표시. */
import * as playstoreRaw from '../../playstore/tools.js';
import { friendlyPlayError } from '../../playstore/errors.js';
import { wrapDomain } from '../../lib/wrap-domain.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    truncated: (n: number) => `목록이 너무 길어 앞쪽 ${n}개만 가져왔습니다 — 이 목록에 없다고 "존재하지 않는다"고 판단하지 마세요.`,
  },
  {
    truncated: (n: number) => `The list is too long, so only the first ${n} items were fetched — do not conclude that something "does not exist" because it is missing from this list.`,
  },
);

// 모든 playstore tools 호출을 친절 에러로 감싸는 프록시 — 403(권한)/404/edit 충돌/
// invalid_grant 를 raw dump 대신 구체적 복구 안내로 변환. args[1] 이 packageName 규약.
// 비-Promise 반환(publisher 등 sync factory)은 그대로 통과, 도메인 에러는 원본 보존.
export const playstore = wrapDomain(playstoreRaw, (err, args) =>
  friendlyPlayError(err, typeof args[1] === 'string' ? args[1] : undefined));

/** 전부 읽었으면 예전처럼 배열 그대로, 페이지 상한에 걸렸으면 잘렸다는 사실을 앞에 붙인다. */
export function truncatedList<T>(result: { items: T[]; truncated: boolean }) {
  if (!result.truncated) return result.items;
  return {
    truncated: true,
    note: M().truncated(result.items.length),
    items: result.items,
  };
}
