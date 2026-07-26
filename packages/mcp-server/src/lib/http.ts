// 외부 HTTP 호출의 공통 상한.
//
// 왜 필요한가: 이 서버는 stdio MCP 로 돈다. 소켓이 응답 없이 매달리면 도구 호출이
// **영원히** 반환하지 않고, 클라이언트는 그 호출을 끊을 방법이 없다 — 에이전트 세션
// 전체가 멈춘다. Node 의 fetch 는 기본 타임아웃이 없으므로(undici 는 연결 타임아웃만
// 있고 응답 대기는 무한) 호출부마다 명시적으로 걸어야 한다.
//
// 규칙: 새 provider 클라이언트를 만들 때 raw `fetch` 를 쓰지 말고 이 래퍼를 쓸 것.

/** JSON/메타데이터 API 의 기본 상한. 대부분의 Google·Apple·Meta·Jenkins 호출. */
export const HTTP_TIMEOUT_MS = 60_000;

/**
 * 바이트 전송(업로드 청크, 에셋 다운로드)용 상한.
 *
 * 스트리밍 응답에도 signal 이 적용되므로 — body 를 다 읽기 전에 abort 되면 전송이
 * 중간에 끊긴다 — 60초는 수백 MB 짜리 미리보기 영상에 너무 짧다. 목적은 "빨리 실패"가
 * 아니라 "무한 대기 금지"이므로 넉넉하게 두되 상한은 반드시 존재하게 한다.
 */
export const HTTP_TRANSFER_TIMEOUT_MS = 600_000;

/**
 * 에러 메시지에 쓸 엔드포인트 라벨.
 *
 * 쿼리스트링은 **의도적으로 버린다** — Meta Graph API 는 `?access_token=...` 로 토큰을
 * 실어 보내므로, URL 을 통째로 에러에 넣으면 토큰이 에이전트 전사록과 로그에 남는다.
 */
function endpointLabel(input: string | URL): string {
  try {
    const url = new URL(String(input));
    return `${url.host}${url.pathname}`;
  } catch {
    return '외부 서버';
  }
}

/** AbortSignal.timeout 이 만든 중단인가. undici 가 cause 로 한 겹 싸는 경우까지 본다. */
function isTimeoutAbort(error: unknown): boolean {
  const named = (e: unknown) => (e as { name?: string } | null)?.name === 'TimeoutError';
  return named(error) || named((error as { cause?: unknown } | null)?.cause);
}

/**
 * 타임아웃이 걸린 `fetch`. 호출부가 이미 signal 을 넘겼으면 그쪽을 존중한다
 * (취소 주체가 둘이 되지 않게 — Node 20.0 에는 AbortSignal.any 가 없어 합성도 못 한다).
 *
 * 인자를 정확히 2개로 넘기는 것은 의도적이다: 기존 테스트들이
 * `expect(fetchMock).toHaveBeenCalledWith(url, expect.any(Object))` 로 계약을 잡고 있다.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = HTTP_TIMEOUT_MS,
): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (isTimeoutAbort(error)) {
      throw new Error(
        `${endpointLabel(input)} 요청이 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않아 중단했습니다. ` +
          '네트워크 상태를 확인하고 다시 시도하세요.',
        { cause: error },
      );
    }
    throw error;
  }
}
