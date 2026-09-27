// nextPageToken 을 끝까지 따라가는 수집기.
//
// 왜 필요한가: IAM 서비스 계정·Service Usage·Play 상품/구독 목록은 첫 페이지만 읽고
// nextPageToken 을 버렸다. 101번째 구독은 "없는 것"이 됐고, 목록을 근거로 한 판단
// (중복 생성 여부, 등록 누락 점검)이 조용히 틀렸다. 호출부마다 루프를 쓰면 다시 빠뜨리므로
// 한 곳에 둔다.

/** 한 번의 목록 호출이 따라갈 최대 페이지 수. 서버가 토큰을 끝없이 돌려줘도 멈춘다. */
export const MAX_PAGES = 50;

export interface Page<T> {
  items: T[];
  nextPageToken?: string | null;
}

export interface CollectedPages<T> {
  items: T[];
  /** 페이지 상한에 걸려 뒤쪽을 못 읽었으면 true — 호출부가 **반드시** 사용자에게 알린다. */
  truncated: boolean;
}

/**
 * 모든 페이지를 모은다. 같은 토큰이 반복되면 무한 루프이므로 항상 에러.
 * 상한에 걸리면 `truncated: true` 로 지금까지 읽은 것을 돌려준다 — 조용히 자르지 않고
 * 표시하는 것이 계약이다.
 */
export async function collectPagesUpTo<T>(
  fetchPage: (pageToken: string | undefined) => Promise<Page<T>>,
  maxPages = MAX_PAGES,
): Promise<CollectedPages<T>> {
  const items: T[] = [];
  const seen = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(token);
    items.push(...result.items);
    const next = result.nextPageToken || undefined;
    if (!next) return { items, truncated: false };
    if (seen.has(next)) throw new Error('목록 API 가 같은 nextPageToken 을 반복해 페이지 순회를 중단했습니다.');
    seen.add(next);
    token = next;
  }
  return { items, truncated: true };
}

/** 전부 읽지 못하면 실패한다 — 부분 목록이 판단 근거로 쓰이면 안 되는 곳(IAM·Firebase)용. */
export async function collectPages<T>(
  fetchPage: (pageToken: string | undefined) => Promise<Page<T>>,
  maxPages = MAX_PAGES,
): Promise<T[]> {
  const { items, truncated } = await collectPagesUpTo(fetchPage, maxPages);
  if (truncated) {
    throw new Error(`목록이 ${maxPages}페이지를 넘어 순회를 중단했습니다 — 결과가 잘리지 않도록 범위를 좁혀 다시 조회하세요.`);
  }
  return items;
}
