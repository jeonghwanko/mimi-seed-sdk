// 앱 식별자 검증 — Android 패키지명 / iOS 번들 ID.
//
// 왜 필요한가: Play 서비스 계정은 `~/.mimi-seed/play-service-accounts/<packageName>.json`
// 에 저장된다. packageName 을 검증 없이 path.join 하면 `../tokens` 가
// `~/.mimi-seed/tokens.json`(Google OAuth 리프레시 토큰)을 가리킨다. 실제로
// `playstore_delete_service_account({ packageName: '../tokens' })` 가 그 파일을 지웠고,
// 원격 동기화는 같은 경로로 OAuth 토큰 파일을 원격에 POST 할 수 있었다.
//
// 스키마(모든 register 의 packageName 파라미터)와 파일 경계(playstore-auth.ts) 양쪽에서
// 같은 규칙을 쓴다 — 한쪽만 막으면 다음 호출 경로가 새로 생길 때 다시 뚫린다.

import { z } from 'zod';

/**
 * Android applicationId 모양: 점으로 구분된 두 개 이상의 세그먼트, 첫 세그먼트는 영문자로
 * 시작, 문자는 [A-Za-z0-9_] 만. `/`, `\`, `..`, 빈 세그먼트는 구조적으로 불가능하다.
 */
export const ANDROID_PACKAGE_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

/** iOS 번들 ID 모양: 영숫자·하이픈 세그먼트를 점으로 잇는다 (빈 세그먼트 불가). */
export const IOS_BUNDLE_ID_RE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;

/** Play 가 허용하는 applicationId 최대 길이를 넉넉히 덮는 상한. */
const MAX_IDENTIFIER_LENGTH = 255;

export function isValidAndroidPackageName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_IDENTIFIER_LENGTH
    && ANDROID_PACKAGE_NAME_RE.test(value);
}

/** 파일 경계용 — 스키마를 우회한 호출(내부 호출·CLI)도 여기서 막힌다. */
export function assertAndroidPackageName(value: unknown): asserts value is string {
  if (!isValidAndroidPackageName(value)) {
    throw new Error(
      `잘못된 Android 패키지명입니다: ${JSON.stringify(String(value).slice(0, 80))} — `
      + 'com.example.app 처럼 점으로 구분된 영숫자/밑줄 세그먼트여야 합니다.',
    );
  }
}

/** register 의 zod 파라미터용. 호출부에서 `.describe(...)` / `.optional()` 을 붙인다. */
export const androidPackageName = z
  .string()
  .max(MAX_IDENTIFIER_LENGTH)
  .regex(ANDROID_PACKAGE_NAME_RE, 'Android 패키지명 형식이 아닙니다 (예: com.example.app)');

/** iOS 번들 ID 용 zod 파라미터. 하이픈을 허용한다. */
export const iosBundleId = z
  .string()
  .max(MAX_IDENTIFIER_LENGTH)
  .regex(IOS_BUNDLE_ID_RE, 'iOS 번들 ID 형식이 아닙니다 (예: com.example.app)');
