// 두 패키지의 fetch 래퍼(cli/src/lib/http.ts, mcp-server/src/lib/http.ts)가 공유하는 **순수 헬퍼**.
//
// 래퍼 자체는 일부러 두 벌이다 — 정책이 다르다: MCP 는 60초 + 429/5xx 재시도(stdio 도구 호출이
// 매달리면 안 된다), CLI 는 30초 + 재시도 없음(사람이 앞에 있고, 폴링은 호출부가 연속 오류를
// 센다) + 에러 문구를 catalog 로 현지화. 그래서 core 에는 네트워크 호출이 없고(core-boundary 가드),
// 두 래퍼가 똑같이 지켜야 하는 판단만 둔다.

/**
 * 에러 메시지에 쓸 엔드포인트 라벨 — host + path 만.
 *
 * 쿼리스트링은 **의도적으로 버린다**: Meta Graph API 의 `?access_token=…`, GitLab 의
 * `?private_token=…` 처럼 토큰이 실릴 수 있고, 에러는 에이전트 전사록·터미널·CI 로그에 남는다.
 * URL 로 해석되지 않으면 호출부가 준 `fallback`(각 패키지 언어의 "외부 서버")을 쓴다.
 */
export function endpointLabel(input: string | URL, fallback: string): string {
  try {
    const url = new URL(String(input));
    return `${url.host}${url.pathname}`;
  } catch {
    return fallback;
  }
}

/** AbortSignal.timeout 이 만든 중단인가. undici 가 cause 로 한 겹 싸는 경우까지 본다. */
export function isTimeoutAbort(error: unknown): boolean {
  const named = (e: unknown) => (e as { name?: string } | null)?.name === 'TimeoutError';
  return named(error) || named((error as { cause?: unknown } | null)?.cause);
}
