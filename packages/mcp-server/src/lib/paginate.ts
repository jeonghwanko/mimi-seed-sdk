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

export async function collectPages<T>(
  fetchPage: (pageToken: string | undefined) => Promise<Page<T>>,
  maxPages = MAX_PAGES,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(token);
    items.push(...result.items);
    const next = result.nextPageToken || undefined;
    if (!next) return items;
    // 같은 토큰을 다시 주면 무한 루프다 — 조용히 잘라 내지 말고 알린다.
    if (seen.has(next)) throw new Error('목록 API 가 같은 nextPageToken 을 반복해 페이지 순회를 중단했습니다.');
    seen.add(next);
    token = next;
  }
  throw new Error(`목록이 ${maxPages}페이지를 넘어 순회를 중단했습니다 — 결과가 잘리지 않도록 범위를 좁혀 다시 조회하세요.`);
}
