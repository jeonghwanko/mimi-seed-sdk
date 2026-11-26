/** checks 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  '로컬 Android 저장소의 Google Play Billing Library 버전을 읽기 전용으로 탐지하고 제출 정책 마감과 비교합니다. build.gradle, build.gradle.kts, gradle/libs.versions.toml의 literal·변수·version catalog와 react-native-iap의 OpenIAP 전이 의존성을 검사합니다. 코드를 자동 수정하지 않고 공식 Android CLI Skill 설치 명령과 업그레이드 프롬프트만 반환합니다.':
    'Detects, read-only, the Google Play Billing Library version in a local Android repository and compares it against the submission policy deadline. Inspects literals, variables, and version catalogs in build.gradle, build.gradle.kts, and gradle/libs.versions.toml, plus react-native-iap\'s transitive OpenIAP dependency. It never modifies code automatically; it returns only the official Android CLI Skill install command and an upgrade prompt.',
  '검사할 프로젝트 절대경로 (기본: MCP 프로세스 현재 디렉터리)':
    'Absolute path of the project to inspect (default: the MCP process\'s current directory)',
  'Google Play 제출 전 위험 요소를 자동으로 점검합니다. 블로커(반드시 수정)와 경고(권장 수정)로 분류하여 반환합니다. 점검 항목: 리스팅 완성도(제목/설명/짧은설명), 스크린샷 수, 아이콘, 빌드 존재 여부, 연락처.':
    'Automatically checks risks before a Google Play submission. Returns them classified as blockers (must fix) and warnings (recommended fix). Checks: store listing completeness (title/description/short description), screenshot count, icon, build existence, contact info.',
  '대상 트랙 (versionCode와 함께 전달)':
    'Target track (pass together with versionCode)',
  '대상 버전 코드 (track과 함께 전달)':
    'Target version code (pass together with track)',
  'App Store 제출 전 위험 요소를 자동으로 점검합니다. 블로커(반드시 수정)와 경고(권장 수정)로 분류하여 반환합니다. 점검 항목: 메타데이터 완성도(설명/What\'s New/키워드), 스크린샷, TestFlight 빌드, 개인정보처리방침 URL. 2026년 9월 필수화된 소셜 미디어 연령등급 응답을 확인하고, 기대 기능 값을 주면 App Store Connect 응답과 비교합니다. App Store 인증이 필요합니다 (appstore_* 도구 사용 가능 상태여야 함).':
    'Automatically checks risks before an App Store submission. Returns them classified as blockers (must fix) and warnings (recommended fix). Checks: metadata completeness (description/What\'s New/keywords), screenshots, TestFlight build, privacy policy URL. Checks the social media age rating answers made mandatory in September 2026, and when expected feature values are given, compares them with the App Store Connect answers. Requires App Store authentication (appstore_* tools must be usable).',
  'App Store 앱 ID (appstore_list_apps 결과의 id 필드)':
    'App Store app ID (the id field of appstore_list_apps results)',
  '대상 App Store 버전 ID (appstore_list_versions 결과)':
    'Target App Store version ID (from appstore_list_versions results)',
  '로컬 스크린샷 파일의 해상도·파일크기·종횡비를 App Store / Play Store 규격과 비교 검증합니다. PNG/JPEG 파일 경로를 배열로 받아 각 파일의 통과 여부와 문제점을 반환합니다. platform: "ios" 또는 "android" (기본: ios) iOS displayType 예시: APP_IPHONE_69, APP_IPHONE_67, APP_IPHONE_65, APP_IPAD_PRO_3GEN_129 Android imageType 예시: phoneScreenshots, sevenInchScreenshots, tenInchScreenshots, featureGraphic 업로드 전 미리 검사하여 리젝 방지에 활용하세요.':
    'Validates the resolution, file size, and aspect ratio of local screenshot files against App Store / Play Store specs. Takes an array of PNG/JPEG file paths and returns pass/fail and problems for each file. platform: "ios" or "android" (default: ios) iOS displayType examples: APP_IPHONE_69, APP_IPHONE_67, APP_IPHONE_65, APP_IPAD_PRO_3GEN_129 Android imageType examples: phoneScreenshots, sevenInchScreenshots, tenInchScreenshots, featureGraphic Use it to check in advance before uploading to prevent rejection.',
  '검증할 이미지 파일 절대경로 배열':
    'Array of absolute paths of image files to validate',
  '플랫폼 (기본: ios)':
    'Platform (default: ios)',
  'iOS 디스플레이 타입 (예: APP_IPHONE_67)':
    'iOS display type (e.g. APP_IPHONE_67)',
  'Android 이미지 타입 (예: phoneScreenshots)':
    'Android image type (e.g. phoneScreenshots)',
  'App Store와 Google Play에서 지정한 릴리스 상태를 조회합니다. App Store는 버전·플랫폼 및 실제 연결된 빌드를, Google Play는 일치하는 모든 트랙과 버전 코드를 반환합니다. appId 또는 packageName 중 하나만 전달하면 해당 스토어만 조회합니다.':
    'Looks up the status of the specified release on the App Store and Google Play. For the App Store, returns the version, platform, and actually attached build; for Google Play, returns every matching track and version code. Pass only one of appId or packageName to query only that store.',
  '조회할 버전명 (예: 1.4.9). App Store 조회에는 필수입니다.':
    'Version name to look up (e.g. 1.4.9). Required for the App Store lookup.',
  'App Store 앱 ID (appstore_list_apps 결과).':
    'App Store app ID (from appstore_list_apps results).',
  '동일한 버전명이 여러 Apple 플랫폼에 있는 경우 조회할 플랫폼.':
    'Platform to query when the same version name exists on multiple Apple platforms.',
  'Google Play 패키지명 (예: com.example.app).':
    'Google Play package name (e.g. com.example.app).',
  'Google Play 버전 코드 (예: 373). 지정하면 Play 조회에 우선하며 Play만 조회할 때 version을 생략할 수 있습니다.':
    'Google Play version code (e.g. 373). When given, it takes precedence for the Play lookup, and version can be omitted when querying only Play.',
} satisfies Record<string, string>;
