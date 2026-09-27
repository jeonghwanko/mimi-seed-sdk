// googleapis(gaxios) 호출의 시간 상한.
//
// googleapis-lite.ts 와 분리해 둔 이유: 거의 모든 테스트가 googleapis-lite 를 통째로
// vi.mock 하므로, 호출부가 쓰는 상수가 그 모듈에 있으면 mock 에 없는 export 로 깨진다.

import { HTTP_TIMEOUT_MS } from './http.js';

/**
 * googleapis 호출의 기본 상한.
 *
 * raw fetch 는 lib/http.ts 가 타임아웃을 강제하지만 googleapis(gaxios) 경로는 기본 타임아웃이
 * **없다**. 응답 없이 매달린 소켓 하나가 stdio 도구 호출을 영원히 붙잡는 같은 결함이 여기엔
 * 그대로 남아 있었다 (2026-09 점검). 대부분의 Google 호출은 메타데이터 JSON 이므로 raw fetch 와
 * 같은 상한을 쓴다.
 */
export const GOOGLEAPIS_TIMEOUT_MS = HTTP_TIMEOUT_MS;

/**
 * 미디어 업로드(Play 이미지, YouTube 영상·썸네일) 호출부가 per-call 로 넘기는 상한.
 * 기본 60초로는 큰 영상이 중간에 끊긴다 — 목적은 "빨리 실패"가 아니라 "무한 대기 금지".
 */
export const GOOGLEAPIS_MEDIA_TIMEOUT_MS = 30 * 60_000;

/** 미디어 업로드 호출의 두 번째 인자로 넘긴다: `api.upload(params, GOOGLEAPIS_MEDIA_OPTIONS)`. */
export const GOOGLEAPIS_MEDIA_OPTIONS = Object.freeze({ timeout: GOOGLEAPIS_MEDIA_TIMEOUT_MS });

/**
 * googleapis-common 은 요청마다 `context.google._options`(전역) → API 별 → 호출별 순서로
 * 옵션을 깊은 병합한다. `google.<api>(...)` 로 부르면 context.google 이 googleapis-lite 의
 * `google` 객체가 되므로, 거기 둔 `_options`(= 아래 값)가 모든 호출의 기본값이 된다.
 *
 * 재시도는 gaxios 기본 정책(멱등 메서드 GET/PUT/DELETE… 의 429·5xx·무응답만)을 그대로 두고
 * 횟수만 줄인다 — POST 는 재시도하지 않으므로 중복 생성 위험이 없고, 타임아웃 × 재시도가
 * 총 대기를 부풀리지 않게 무응답 재시도는 1회로 제한한다.
 */
export const GOOGLEAPIS_DEFAULT_OPTIONS = Object.freeze({
  timeout: GOOGLEAPIS_TIMEOUT_MS,
  retryConfig: Object.freeze({ retry: 2, noResponseRetries: 1 }),
});
