// 외부 HTTP 호출의 공통 진입점 — 타임아웃 + 일시적 실패 재시도.
//
// 왜 타임아웃이 필요한가: 이 서버는 stdio MCP 로 돈다. 소켓이 응답 없이 매달리면
// 도구 호출이 **영원히** 반환하지 않고, 클라이언트는 그 호출을 끊을 방법이 없다 —
// 에이전트 세션 전체가 멈춘다. Node 의 fetch 는 기본 타임아웃이 없다(undici 는 연결
// 타임아웃만 있고 응답 대기는 무한).
//
// 왜 재시도가 필요한가: Play / App Store Connect / Meta 는 정상 운영 중에도 429 와
// 일시적 5xx 를 돌려준다. 재시도가 없으면 그 한 번에 도구가 실패하고, 특히 스크린샷·
// 미리보기 **다중 청크 업로드 중간**에 터지면 서버 쪽에 부분 상태가 남는다.
//
// 규칙: 새 provider 클라이언트를 만들 때 raw `fetch` 를 쓰지 말고 이 래퍼를 쓸 것
// (`__tests__/http-timeout.test.ts` 가 강제한다).

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

/** 총 시도 횟수 (최초 1회 + 재시도 2회). */
export const HTTP_MAX_ATTEMPTS = 3;

/** 첫 재시도까지의 대기. 이후 2배씩 늘어난다. */
const BASE_BACKOFF_MS = 500;

/** Retry-After 가 아무리 길어도 이 이상은 기다리지 않는다 — 도구 호출이 매달린 것과 같아진다. */
const MAX_BACKOFF_MS = 20_000;

/**
 * 재시도가 **추가로** 쓸 수 있는 총 시간.
 *
 * 재시도 도입 전의 상한은 timeoutMs 하나였다(전송은 600초). 시도마다 그 상한을 새로
 * 주면 총 30분까지 늘어나서, 이 모듈이 존재하는 이유("도구 호출이 매달리면 안 된다")를
 * 재시도가 되살린다. 그래서 총 예산 = timeoutMs + 이 값으로 못박는다.
 */
const RETRY_WINDOW_MS = 30_000;

/** 예산이 거의 소진돼도 최소한 이만큼은 준다 — 0초 타임아웃으로 즉시 죽는 것을 막는다. */
const MIN_ATTEMPT_MS = 1_000;

/**
 * 메서드가 재요청해도 안전한가(RFC 9110 idempotent).
 *
 * POST 는 여기 없다. 5xx 나 네트워크 오류는 **서버가 이미 처리했는지 알 수 없는**
 * 상태이고, POST 를 다시 보내면 리소스가 두 개 생긴다(버전·제품·심사 제출이 중복
 * 생성되는 쪽이 한 번 실패하는 것보다 훨씬 나쁘다).
 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'TRACE']);

/** 일시적이라고 보는 상태 코드. 408·425 도 재요청이 정답인 표준 케이스다. */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

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
 * 본문을 다시 보낼 수 있는가.
 *
 * 스트림 본문은 한 번 읽히면 소진돼 재전송이 조용히 빈 요청이 된다. 문자열·버퍼·
 * FormData 는 안전하다.
 */
function isReplayableBody(body: BodyInit | null | undefined): boolean {
  if (body == null) return true;
  if (typeof body === 'string') return true;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return true;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
  return false; // ReadableStream 등 — 재전송 불가
}

/**
 * `Retry-After` 해석. 초 단위 숫자와 HTTP-date 두 형식을 모두 받는다.
 * 해석 실패나 음수면 null (호출부가 지수 백오프로 폴백).
 */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();

  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, MAX_BACKOFF_MS);
  }

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  const delta = at - nowMs;
  if (delta <= 0) return 0;
  return Math.min(delta, MAX_BACKOFF_MS);
}

/** 시도 번호(0부터)에 대한 지수 백오프 + 지터. 지터는 동시 재시도가 몰리는 것을 막는다. */
function backoffFor(attempt: number): number {
  const base = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return base + Math.floor(Math.random() * (base / 2));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 백오프가 총 예산을 넘기지 않게 자른다. */
const cappedWait = (wait: number, deadline: number) =>
  Math.max(0, Math.min(wait, deadline - Date.now()));

export interface FetchOptions {
  /** 한 **시도당** 상한. 총 소요 시간의 상한은 아래 RETRY_WINDOW_MS 를 더한 값이다. */
  timeoutMs?: number;
  /** 총 시도 횟수. 1 이면 재시도하지 않는다. */
  maxAttempts?: number;
}

/**
 * 타임아웃 + 재시도가 붙은 `fetch`.
 *
 * 재시도 정책:
 *  - **429** 는 메서드와 무관하게 재시도한다. 레이트 리미터는 요청을 처리하기 전에
 *    거절하므로 POST 라도 중복 생성이 일어나지 않는다.
 *  - **5xx / 빠른 네트워크 오류**(ECONNRESET·DNS 등)는 idempotent 메서드에서만.
 *    POST 는 서버가 이미 처리했는지 알 수 없어 재요청이 중복 생성을 만든다.
 *  - **타임아웃은 재시도하지 않는다.** 아래 시간 예산 참고.
 *  - `Retry-After` 가 있으면 그 값을 쓰고, 없으면 지수 백오프 + 지터.
 *  - 재전송 불가능한 본문(스트림)이면 재시도하지 않는다.
 *
 * 호출부가 `signal` 을 넘기면 그쪽 취소를 존중하고 **재시도하지 않는다** — 취소 주체가
 * 둘이 되면 안 되고, Node 20.0 에는 AbortSignal.any 가 없어 합성도 못 한다.
 *
 * 세 번째 인자는 숫자(=timeoutMs)도 받는다 — 기존 호출부 호환.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  options: number | FetchOptions = {},
): Promise<Response> {
  const opts: FetchOptions = typeof options === 'number' ? { timeoutMs: options } : options;
  const timeoutMs = opts.timeoutMs ?? HTTP_TIMEOUT_MS;

  const method = (init.method ?? 'GET').toUpperCase();
  const callerSignal = init.signal != null;
  const replayable = !callerSignal && isReplayableBody(init.body);
  const maxAttempts = replayable ? (opts.maxAttempts ?? HTTP_MAX_ATTEMPTS) : 1;
  const idempotent = IDEMPOTENT_METHODS.has(method);

  // 총 시간 예산. 재시도가 없던 시절의 상한(timeoutMs)에 재시도 창만 더한 값으로
  // 고정한다 — 이게 없으면 전송용 600초 × 3회 = 30분이 되어, 이 모듈이 애초에
  // 막으려던 "도구 호출이 매달림"을 재시도가 되살린다.
  const deadline = Date.now() + timeoutMs + (maxAttempts > 1 ? RETRY_WINDOW_MS : 0);
  /** 남은 예산 안에서 다음 시도를 시작해도 되는가. */
  const hasBudget = (next: number) => next < maxAttempts && Date.now() < deadline;

  for (let attempt = 0; ; attempt += 1) {
    // 마지막 시도가 예산을 넘겨 달리지 않도록, 남은 시간으로 잘라준다.
    const attemptTimeout = Math.min(timeoutMs, Math.max(deadline - Date.now(), MIN_ATTEMPT_MS));
    const signal = init.signal ?? AbortSignal.timeout(attemptTimeout);

    let response: Response;
    try {
      response = await fetch(input, { ...init, signal });
    } catch (error) {
      // 타임아웃은 재시도하지 않는다. 이미 예산을 통째로 쓴 실패이고, 같은 상한으로
      // 두 번 더 기다려도 얻는 게 없다 — 총 소요 시간만 배로 늘린다.
      if (isTimeoutAbort(error)) {
        throw new Error(
          `${endpointLabel(input)} 요청이 ${Math.round(attemptTimeout / 1000)}초 안에 끝나지 않아 중단했습니다. ` +
            '네트워크 상태를 확인하고 다시 시도하세요.',
          { cause: error },
        );
      }

      // 응답 전 실패는 서버가 요청을 받았는지 알 수 없다 → idempotent 에서만 재시도.
      if (!idempotent || !hasBudget(attempt + 1)) throw error;
      await sleep(cappedWait(backoffFor(attempt), deadline));
      continue;
    }

    if (response.ok || !TRANSIENT_STATUS.has(response.status)) return response;
    // 429 는 처리 전 거절이므로 POST 도 안전하다. 그 외 일시적 오류는 idempotent 만.
    if (response.status !== 429 && !idempotent) return response;
    if (!hasBudget(attempt + 1)) return response;

    const wait = parseRetryAfter(response.headers.get('retry-after'), Date.now()) ?? backoffFor(attempt);
    // 재시도할 응답의 본문은 읽지 않고 버린다 — 소켓을 붙잡고 있지 않도록.
    await response.body?.cancel().catch(() => undefined);
    await sleep(cappedWait(wait, deadline));
  }
}
