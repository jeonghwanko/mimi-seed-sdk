// Google API 리소스 이름 검증 — `projects/${projectId}/androidApps/${appId}` 같은 문자열용.
//
// 왜 인코딩이 아니라 검증인가: googleapis 는 `name`/`parent`/`resource`/`projectId` 등을
// URI 템플릿의 **예약 확장** `{+name}` 으로 경로에 넣는다. 예약 확장은 `/` 를 인코딩하지 않고,
// 반대로 우리가 미리 %2F 로 인코딩해 두면 Google 이 디코딩하지 않아 정상 ID 가 깨진다.
// 실측(2026-09 적대적 재검토):
//   firebase_delete_android_app({ projectId: 'A', appId: '../../B/androidApps/Z' })
//     → POST /v1beta1/projects/B/androidApps/Z:remove   (다른 프로젝트의 앱 삭제)
// 그래서 호출자 값이 **한 세그먼트**인지 검증한다: 허용 문자만, `/` 없음, `.`/`..` 불가.
// `path-encoding.test.ts` 가 Google 도메인 폴더에서 이 함수 없이 `x/${…}` 를 만드는 코드를 막는다.

/**
 * 한 세그먼트로 허용하는 문자. Google 리소스 ID 에 실제로 쓰이는 것만:
 * 영숫자, `-` `_` `.`(도메인·서비스명), `:`(Firebase appId `1:123:android:ab`, BigQuery
 * `domain.com:project`), `@`(서비스 계정 이메일).
 */
const SEGMENT = /^[A-Za-z0-9:_.@-]+$/;
const MAX_SEGMENT_LENGTH = 1024;

export function resourceSegment(value: string, label = 'ID'): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_SEGMENT_LENGTH
    || value === '.'
    || value === '..'
    || !SEGMENT.test(value)
  ) {
    throw new Error(
      `${label} 형식이 올바르지 않습니다: ${JSON.stringify(String(value).slice(0, 80))} — `
      + '영숫자와 - _ . : @ 만 쓸 수 있고 / 나 . / .. 단독 값은 허용하지 않습니다.',
    );
  }
  return value;
}

/**
 * 단순 확장 `{siteUrl}` 처럼 googleapis 가 `/` 를 인코딩해 주는 파라미터용. 전체 값이 정확히
 * `.` / `..` 이면 인코딩돼도 URL 정규화로 상위 경로가 되므로 그것만 막는다 (URL 같은 값은 통과).
 */
export function notDotSegment(value: string, label = 'ID'): string {
  if (value === '' || value === '.' || value === '..') {
    throw new Error(`${label} 로 쓸 수 없는 값입니다: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * `123` 또는 `accounts/123` 을 받아 `accounts/123` 으로 정규화하되, 나머지 부분이 정확히
 * 한 세그먼트인지 검증한다. `accounts/1/../../x` 같은 값은 여기서 막힌다.
 */
export function resourceName(value: string, collection: string, label = `${collection} ID`): string {
  const trimmed = value.trim();
  const id = trimmed.startsWith(`${collection}/`) ? trimmed.slice(collection.length + 1) : trimmed;
  return `${collection}/${resourceSegment(id, label)}`;
}
