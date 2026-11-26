/** firebase 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  'Firebase Remote Config의 일일 fetch 사용량, 과금 임계치, 현재 템플릿, A/B 실험과 rollout을 한 번에 조회합니다. 사용량은 Cloud Monitoring의 공식 fetch_request_count 메트릭을 사용하며, 조회 권한이 없으면 숫자를 추정하지 않고 unavailable로 반환합니다. 읽기 전용입니다. 10만 건 무료 구간 대비 80%부터 warning, 100%부터 critical로 표시합니다.':
    'Fetches Firebase Remote Config daily fetch usage, the billing threshold, the current template, and A/B experiments and rollouts in one call. Usage comes from the official Cloud Monitoring fetch_request_count metric; without permission to read it, returns unavailable instead of estimating a number. Read-only. Flags warning from 80% and critical from 100% of the 100,000-request free tier.',
  'Firebase / Google Cloud 프로젝트 ID':
    'Firebase / Google Cloud project ID',
  'Remote Config namespace (기본: firebase)':
    'Remote Config namespace (default: firebase)',
  '사용량 조회 일수 (기본: 7, 최대: 30)':
    'Number of days of usage to retrieve (default: 7, max: 30)',
  'API quota/과금 프로젝트 ID. 기본은 projectId. Spark 프로젝트의 Monitoring 조회가 billing_required이면 Remote Config·Monitoring API가 활성화된 Blaze 프로젝트를 지정':
    'Project ID for API quota/billing. Defaults to projectId. If the Monitoring query on a Spark project returns billing_required, specify a Blaze project with the Remote Config and Monitoring APIs enabled',
  '내 Firebase 프로젝트 목록 조회':
    'List my Firebase projects',
  'Firebase 프로젝트 상세 정보 조회':
    'Get Firebase project details',
  'Firebase 프로젝트 ID':
    'Firebase project ID',
  '새 GCP 프로젝트를 만들고 Firebase를 추가한다 (앱 하나당 전용 Firebase 프로젝트 컨벤션 — 기존 프로젝트에 앱만 추가하려면 firebase_create_android_app/firebase_create_ios_app 사용). 두 개의 long-running operation(프로젝트 생성 → Firebase 추가)을 순서대로 완료까지 폴링하므로 최악의 경우 2분 정도 걸릴 수 있다. projectId는 6-30자, 소문자로 시작, 소문자/숫자/하이픈만 가능(끝에 하이픈 금지).':
    'Creates a new GCP project and adds Firebase to it (convention: one dedicated Firebase project per app — to add an app to an existing project only, use firebase_create_android_app/firebase_create_ios_app). Polls two long-running operations (project creation → adding Firebase) to completion in order, so it can take about 2 minutes in the worst case. projectId: 6-30 characters, must start with a lowercase letter, lowercase letters/digits/hyphens only (no trailing hyphen).',
  '새로 만들 GCP/Firebase 프로젝트 ID (예: my-app-prod)':
    'ID of the new GCP/Firebase project to create (e.g. my-app-prod)',
  '프로젝트 표시 이름':
    'Project display name',
  '조직/폴더 소속이 필요한 계정일 때만: \'organizations/<id>\' 또는 \'folders/<id>\'. 생략 시 계정 기본 정책대로 생성':
    'Only for accounts that require an organization/folder: \'organizations/<id>\' or \'folders/<id>\'. When omitted, the project is created per the account\'s default policy',
  'Firebase 프로젝트의 Android 앱 목록':
    'List Android apps in a Firebase project',
  'Firebase에 새 Android 앱 등록':
    'Register a new Android app in Firebase',
  'Android 패키지명 (예: com.example.myapp)':
    'Android package name (e.g. com.example.myapp)',
  '앱 표시 이름':
    'App display name',
  'google-services.json 다운로드':
    'Download google-services.json',
  'Firebase 앱 ID':
    'Firebase app ID',
  'Firebase Android 앱 삭제':
    'Delete a Firebase Android app',
  '삭제할 Firebase 앱 ID':
    'Firebase app ID to delete',
  'Firebase 프로젝트의 iOS 앱 목록':
    'List iOS apps in a Firebase project',
  'Firebase에 새 iOS 앱 등록':
    'Register a new iOS app in Firebase',
  'iOS Bundle ID (예: com.example.myapp)':
    'iOS Bundle ID (e.g. com.example.myapp)',
  'GoogleService-Info.plist 다운로드':
    'Download GoogleService-Info.plist',
  'Firebase iOS 앱 삭제':
    'Delete a Firebase iOS app',
  'Firebase 프로젝트의 Web 앱 목록':
    'List Web apps in a Firebase project',
  'Firebase에 새 Web 앱 등록':
    'Register a new Web app in Firebase',
  'Firebase Web 설정 (firebaseConfig 객체) 조회':
    'Get the Firebase Web config (firebaseConfig object)',
  'Firebase Web 앱 삭제':
    'Delete a Firebase Web app',
  'GCP 서비스 활성화 (예: firestore.googleapis.com)':
    'Enable a GCP service (e.g. firestore.googleapis.com)',
  '프로젝트 ID':
    'Project ID',
  '서비스 ID (예: firestore.googleapis.com)':
    'Service ID (e.g. firestore.googleapis.com)',
  'Firebase 기본 서비스 일괄 활성화 (Firestore, Auth, Storage, FCM 등)':
    'Enable the core Firebase services in bulk (Firestore, Auth, Storage, FCM, etc.)',
  '프로젝트에서 활성화된 GCP 서비스 목록':
    'List the GCP services enabled in a project',
  'Firebase 프로젝트에 Google Analytics(GA4) 링크 → 앱별 measurement 자동 활성화. analyticsAccountId(그 계정에 GA4 property 신규 생성) 또는 analyticsPropertyId(기존 property 링크) 중 하나 필수. 먼저 firebase_enable_common_services 로 firebaseanalytics 활성화 권장. property 이름/web stream 까지 직접 제어하려면 ga4_create_property/ga4_create_data_stream 사용.':
    'Links Google Analytics (GA4) to a Firebase project → automatically enables measurement per app. One of analyticsAccountId (creates a new GA4 property in that account) or analyticsPropertyId (links an existing property) is required. Recommended: enable firebaseanalytics with firebase_enable_common_services first. To control the property name/web stream directly, use ga4_create_property/ga4_create_data_stream.',
  'GA 계정 ID (신규 property 생성 위치) — 예: 123456':
    'GA account ID (where the new property is created) — e.g. 123456',
  '기존 GA4 property ID 에 링크할 경우':
    'When linking to an existing GA4 property ID',
  '프로젝트의 GA4 링크 상세 — 연결된 analyticsProperty + 앱↔data stream 매핑 조회.':
    'The project\'s GA4 link details — gets the linked analyticsProperty + the app↔data stream mapping.',
} satisfies Record<string, string>;
