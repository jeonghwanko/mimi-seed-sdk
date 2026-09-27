// CLI 의 모든 외부 HTTP 호출이 지나는 유일한 관문 — 타임아웃이 기본값이 되게 한다.
//
// Node 의 fetch 는 응답 대기 타임아웃이 없다(undici 는 연결 타임아웃만 있다). 소켓이 응답 없이
// 매달리면 `mimi-seed deploy` 의 CI 폴링, `doctor` 의 서버 확인, `init` 의 앱 등록이 **영원히**
// 멈추고, 사용자는 Ctrl+C 말고는 알 방법이 없다. 타임아웃은 호출부마다 기억해야 하는 규칙이
// 아니라 기본값이어야 한다 (`__tests__/http-timeout.test.ts` 가 raw `fetch(` 를 막는다).
//
// mcp-server 의 lib/http.ts 와 같은 역할이지만 일부러 더 작다: 재시도는 없다. CLI 의 호출은
// 사람이 앞에 앉아 있고, 재시도가 의미 있는 곳(CI 폴링)은 호출부가 이미 연속 오류를 센다.
// 두 패키지는 서로를 import 하지 않으므로 복사본이다.

import { catalog } from "../i18n.js";

/** JSON API 호출의 기본 상한. 웹 콘솔·원격 MCP·GitHub·GitLab·Jenkins. */
export const HTTP_TIMEOUT_MS = 30_000;

/**
 * 스트리밍 응답(SSE 배포 파이프라인)의 상한.
 *
 * signal 은 본문을 다 읽을 때까지 유효하므로 30초면 스트림이 중간에 잘린다. 목적은 "빨리
 * 실패"가 아니라 "무한 대기 금지"라서 넉넉하게 두되 상한은 반드시 존재하게 한다.
 */
export const HTTP_STREAM_TIMEOUT_MS = 30 * 60_000;

const M = catalog(
  {
    timedOut: (endpoint: string, seconds: number) =>
      `${endpoint} 요청이 ${seconds}초 안에 끝나지 않아 중단했습니다. 네트워크 상태를 확인하고 다시 시도하세요.`,
    unknownEndpoint: "외부 서버",
  },
  {
    timedOut: (endpoint: string, seconds: number) =>
      `The request to ${endpoint} did not finish within ${seconds}s and was aborted. Check your network and try again.`,
    unknownEndpoint: "the remote server",
  },
);

/**
 * 에러 메시지용 엔드포인트 라벨 — host + path 만.
 * 쿼리스트링은 버린다: 토큰이 실릴 수 있고, 에러는 터미널·CI 로그에 남는다.
 */
function endpointLabel(input: string | URL): string {
  try {
    const url = new URL(String(input));
    return `${url.host}${url.pathname}`;
  } catch {
    return M().unknownEndpoint;
  }
}

/** AbortSignal.timeout 이 만든 중단인가. undici 가 cause 로 한 겹 싸는 경우까지 본다. */
function isTimeoutAbort(error: unknown): boolean {
  const named = (e: unknown) => (e as { name?: string } | null)?.name === "TimeoutError";
  return named(error) || named((error as { cause?: unknown } | null)?.cause);
}

/**
 * 본문을 읽다가 끊긴 중단인가 (TimeoutError **또는** AbortError, 한 겹 cause 포함).
 *
 * fetchWithTimeout 의 signal 은 응답 헤더 뒤에도 본문을 다 읽을 때까지 살아 있다. 그 사이에
 * 상한이 지나면 `reader.read()` / `res.text()` 는 런타임에 따라 TimeoutError 가 아니라
 * AbortError 로 끊긴다. 호출부가 signal 을 따로 넘기지 않았다면 그 중단의 주인은 우리 타이머뿐이다.
 */
function isBodyAbort(error: unknown): boolean {
  const named = (e: unknown) => {
    const name = (e as { name?: string } | null)?.name;
    return name === "TimeoutError" || name === "AbortError";
  };
  return named(error) || named((error as { cause?: unknown } | null)?.cause);
}

function timeoutError(input: string | URL, timeoutMs: number, cause: unknown): Error {
  return new Error(M().timedOut(endpointLabel(input), Math.max(1, Math.round(timeoutMs / 1000))), { cause });
}

/**
 * fetchWithTimeout 으로 받은 응답의 **본문 읽기**를 감싼다 — 스트림 도중에 상한이 지나도 날것의
 * AbortError 대신 fetch 단계와 같은 안내 메시지를 낸다. (SSE 배포 스트림, 원격 MCP 응답.)
 * `input` / `timeoutMs` 는 그 fetch 에 준 값 그대로.
 */
export async function readBodyWithTimeout<T>(
  input: string | URL,
  timeoutMs: number,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isBodyAbort(error)) throw timeoutError(input, timeoutMs, error);
    throw error;
  }
}

/**
 * 타임아웃이 붙은 `fetch`.
 *
 * 호출부가 `init.signal` 을 넘기면 그걸 그대로 쓴다(취소 주체는 하나여야 한다 — Node 20.0 에는
 * AbortSignal.any 가 없어 합성도 못 한다). 타임아웃은 사람이 읽을 수 있는 에러로 바꾸고 원인은
 * `cause` 에 남긴다. 그 밖의 에러는 그대로 통과시킨다.
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
    if (isTimeoutAbort(error)) throw timeoutError(input, timeoutMs, error);
    throw error;
  }
}
