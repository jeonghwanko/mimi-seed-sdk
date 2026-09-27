// URL 경로 세그먼트 인코딩 — 호출자 입력을 REST 경로에 끼워 넣을 때 쓴다.
//
// 왜 필요한가: App Store Connect·Graph API 클라이언트는 `/appScreenshots/${screenshotId}` 처럼
// 호출자가 준 ID 를 그대로 경로에 넣었다. `screenshotId = "../appScreenshotSets/<id>"` 같은
// 값이면 URL 정규화가 `..` 를 해석해 **다른 리소스에 DELETE** 가 나간다.
//
// encodeURIComponent 는 `/` 를 %2F 로 바꿔 세그먼트를 못 벗어나게 하지만, 값 자체가 `.` 이나
// `..` 이면 여전히 한 단계 위로 올라간다(WHATWG URL 은 점 세그먼트를 정규화한다). 그래서
// 인코딩과 점 세그먼트 거부를 한 함수로 묶는다. `path-encoding.test.ts` 가 사용을 강제한다.

export function encodePathSegment(value: string | number): string {
  const raw = String(value);
  if (raw === '' || raw === '.' || raw === '..') {
    throw new Error(`URL 경로 세그먼트로 쓸 수 없는 값입니다: ${JSON.stringify(raw)}`);
  }
  return encodeURIComponent(raw);
}
