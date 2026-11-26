/** ga4 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  '접근 가능한 Google Analytics 계정 + 각 계정의 GA4 property 요약. accountId / propertyId 를 확인할 때 먼저 호출.':
    'Accessible Google Analytics accounts plus a summary of each account\'s GA4 properties. Call this first to find accountId / propertyId.',
  '특정 GA 계정 하위 GA4 property 목록.':
    'List the GA4 properties under a given GA account.',
  'GA 계정 ID — \'123\' 또는 \'accounts/123\'':
    'GA account ID — \'123\' or \'accounts/123\'',
  '새 GA4 property 생성. 생성 후 ga4_create_data_stream 으로 플랫폼별 stream(웹=measurement ID, 앱=firebaseAppId)을 붙인다.':
    'Create a new GA4 property. After creating it, attach a per-platform stream with ga4_create_data_stream (web = measurement ID, app = firebaseAppId).',
  'property 표시 이름 (예: SpeakReward)':
    'Property display name (e.g. SpeakReward)',
  'IANA 타임존 (기본 \'America/Los_Angeles\', 예: \'Asia/Seoul\')':
    'IANA time zone (default \'America/Los_Angeles\', e.g. \'Asia/Seoul\')',
  'ISO 4217 통화코드 (기본 \'USD\', 예: \'KRW\')':
    'ISO 4217 currency code (default \'USD\', e.g. \'KRW\')',
  'GA4 property 에 data stream 생성. web → measurementId(G-XXXX) 반환, android/ios → firebaseAppId 반환(Firebase 링크 시). RN 앱은 android/ios 스트림 사용.':
    'Create a data stream on a GA4 property. web → returns measurementId (G-XXXX); android/ios → returns firebaseAppId (when linked to Firebase). React Native (RN) apps use android/ios streams.',
  'GA4 property ID — \'123456789\' 또는 \'properties/123456789\'':
    'GA4 property ID — \'123456789\' or \'properties/123456789\'',
  '스트림 플랫폼':
    'Stream platform',
  '스트림 표시 이름':
    'Stream display name',
  'web 전용 — 사이트 URL (예: https://example.com)':
    'web only — site URL (e.g. https://example.com)',
  'android 전용 — 패키지명 (예: com.example.app)':
    'android only — package name (e.g. com.example.app)',
  'ios 전용 — Bundle ID (예: com.example.app)':
    'ios only — Bundle ID (e.g. com.example.app)',
  'GA4 property 의 data stream 목록 (measurementId / firebaseAppId 평탄화).':
    'List the data streams of a GA4 property (measurementId / firebaseAppId flattened).',
  'GA4 → BigQuery export 링크 생성 계획을 읽기 전용으로 점검. 기존 링크, 대상 프로젝트, 데이터셋 위치와 export 옵션을 반환하며 원격 상태를 변경하지 않는다.':
    'Read-only check of the plan to create a GA4 → BigQuery export link. Returns existing links, the target project, the dataset location, and export options; does not change any remote state.',
  'Google Cloud 프로젝트 ID — \'my-project\' 또는 \'projects/my-project\'':
    'Google Cloud project ID — \'my-project\' or \'projects/my-project\'',
  '생성할 BigQuery 데이터셋 위치 (예: \'asia-northeast3\', \'US\', \'EU\'). 생성 후 변경 불가':
    'Location of the BigQuery dataset to create (e.g. \'asia-northeast3\', \'US\', \'EU\'). Cannot be changed after creation',
  '일일 내보내기 활성화 (기본 true)':
    'Enable daily export (default true)',
  '스트리밍 내보내기 활성화 (기본 false, 추가 비용 가능)':
    'Enable streaming export (default false; may incur extra cost)',
  'Fresh Daily 내보내기 활성화 (기본 false, 지원 속성만 가능)':
    'Enable Fresh Daily export (default false; supported properties only)',
  '모바일 광고 식별자 포함 (기본 false, 개인정보 정책 확인 필요)':
    'Include mobile advertising identifiers (default false; check your privacy policy first)',
  'GA4 → BigQuery export 링크 생성. confirm 생략/false 시 읽기 전용 계획만 반환하고, confirm: true 일 때만 계획을 재검사한 뒤 생성한다. 기존 링크가 있으면 no-op.':
    'Create a GA4 → BigQuery export link. When confirm is omitted/false, returns only the read-only plan; only with confirm: true does it re-check the plan and then create the link. No-op if a link already exists.',
  'true 명시 시에만 원격 링크 생성. 생략/false 면 계획만 반환':
    'Creates the remote link only when explicitly true. When omitted/false, returns only the plan',
  'GA4 Data API 리포트 (활성 사용자·이벤트 등). 전체 행 수(rowCount)와 현재 페이지를 반환. 페이지 순회는 첫 요청부터 limit 또는 offset: 0을 지정.':
    'GA4 Data API report (active users, events, etc.). Returns the total row count (rowCount) and the current page. To paginate, set limit or offset: 0 starting from the first request.',
  '시작일 (YYYY-MM-DD 또는 \'NdaysAgo\', \'today\')':
    'Start date (YYYY-MM-DD or \'NdaysAgo\', \'today\')',
  '종료일 (YYYY-MM-DD 또는 \'today\')':
    'End date (YYYY-MM-DD or \'today\')',
  '쉼표 구분 dimension (예: date,country). 생략 시 전체 합계':
    'Comma-separated dimensions (e.g. date,country). When omitted, returns the overall total',
  '쉼표 구분 metric (기본 activeUsers,eventCount)':
    'Comma-separated metrics (default activeUsers,eventCount)',
  '페이지 크기 (기본 10000, 최대 250000)':
    'Page size (default 10000, max 250000)',
  '조회 시작 행의 0부터 세는 위치 (기본 0)':
    'Zero-based position of the first row to return (default 0)',
} satisfies Record<string, string>;
