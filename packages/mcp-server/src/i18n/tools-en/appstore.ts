/** appstore 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  'App Store Connect Analytics의 표준 주간 Engagement·Downloads·Purchases 리포트를 내려받아 지난 두 기간을 비교합니다. 제품 페이지·획득·수익화 중 가장 크게 악화된 한 영역과 근거 지표, 실행할 개선안 하나를 반환합니다. ONGOING report request가 없으면 기본은 생성하지 않습니다. createIfMissing=true와 confirmCreate=true를 함께 줘야 생성하며 최초 데이터는 24~48시간 뒤 제공됩니다.':
    'Downloads the standard weekly Engagement, Downloads, and Purchases reports from App Store Connect Analytics and compares the last two periods. Returns the single area that worsened most among product page, acquisition, and monetization, with the supporting metrics and one improvement to act on. If no ONGOING report request exists, none is created by default. It is created only when createIfMissing=true and confirmCreate=true are both passed; the first data becomes available 24–48 hours later.',
  'App Store 앱 ID':
    'App Store app ID',
  'ONGOING Analytics report request가 없을 때 생성 준비':
    'Prepare to create an ONGOING Analytics report request when none exists',
  '지속 Analytics report request 생성 명시 확인':
    'Explicit confirmation to create the ongoing Analytics report request',
  'App Store Connect 앱 목록 조회':
    'List App Store Connect apps',
  'App Store Connect API 키(appstore.json) 유효성 검증 — JWT 서명 + GET /apps 호출로 creds/sign/auth/api 단계별 진단. 첫 도구 호출에서 401로 늦게 터지기 전에 setup 직후 확인용. 매출 리포트 접근 가능 여부도 함께 확인한다 — 그쪽만 요구 롤이 달라서 (Admin/Finance/Sales and Reports) 앱 메타데이터는 다 되는데 매출만 403 인 키가 흔하다. 인자 없음.':
    'Validate the App Store Connect API key (appstore.json) — JWT signing + a GET /apps call, diagnosed step by step: creds/sign/auth/api. Use right after setup, so a problem surfaces now rather than as a late 401 on the first tool call. Also checks whether sales reports are accessible — those alone require a different role (Admin/Finance/Sales and Reports), so a key that works for all app metadata but gets 403 on sales only is common. No arguments.',
  'App Store Connect 앱 상세 정보':
    'App Store Connect app details',
  '앱 ID (숫자)':
    'App ID (numeric)',
  'App Store 버전 목록 (플랫폼과 심사 상태 포함). 버전 문자열과 플랫폼으로 검색할 수 있습니다.':
    'List App Store versions (with platform and review state). Can search by version string and platform.',
  '앱 ID':
    'App ID',
  '찾을 버전 문자열':
    'Version string to find',
  '찾을 플랫폼':
    'Platform to find',
  'App Store 새 버전 레코드 생성 — POST /v1/appStoreVersions. 새 versionString(예: "1.2.3")으로 PREPARE_FOR_SUBMISSION 상태의 버전을 만듦. buildId를 함께 주면 생성과 동시에 빌드 연결. 나중에 붙이려면 appstore_attach_build 사용. releaseType: MANUAL(개발자가 출시) / AFTER_APPROVAL(승인 후 자동) / SCHEDULED(earliestReleaseDate 필요).':
    'Create a new App Store version record — POST /v1/appStoreVersions. Creates a version in PREPARE_FOR_SUBMISSION state with a new versionString (e.g. "1.2.3"). Passing buildId also attaches the build on creation. To attach later, use appstore_attach_build. releaseType: MANUAL (developer releases) / AFTER_APPROVAL (automatic after approval) / SCHEDULED (requires earliestReleaseDate).',
  'App Store 앱 ID (appstore_list_apps 결과의 id, 숫자형)':
    'App Store app ID (the id from appstore_list_apps, numeric)',
  '버전 문자열 (예: "1.2.3")':
    'Version string (e.g. "1.2.3")',
  '플랫폼 (기본 IOS)':
    'Platform (default IOS)',
  '저작권 표기 (예: "© 2026 Foo Inc.")':
    'Copyright notice (e.g. "© 2026 Foo Inc.")',
  '출시 방식 (생략 시 Apple 기본값)':
    'Release type (when omitted, Apple\'s default)',
  'SCHEDULED일 때 가장 빠른 출시 시각 (ISO 8601, 예: "2026-05-01T00:00:00Z")':
    'Earliest release time when SCHEDULED (ISO 8601, e.g. "2026-05-01T00:00:00Z")',
  '연결할 빌드 ID (appstore_list_builds 결과). 생략 시 버전만 생성하고 나중에 attach.':
    'Build ID to attach (from appstore_list_builds). When omitted, only the version is created; attach later.',
  'App Store 버전에 업로드된 빌드를 연결 — PATCH /v1/appStoreVersions/{id}/relationships/build. TestFlight에 업로드되어 processingState=VALID 상태인 빌드만 연결 가능. 편집 가능한 버전(PREPARE_FOR_SUBMISSION 등)에서만 변경됨. buildId 는 appstore_list_builds 결과. 생략하면 최신 VALID 빌드를 자동 선택한다 — versionId 로 appId 역추적 → processingState=VALID 만 필터 → buildNumber 최대값 → attach (PROCESSING 빌드 오연결 차단). minBuildNumber 로 자동 선택의 floor 지정 가능 (예: 1.4.x 빌드만).':
    'Attach an uploaded build to an App Store version — PATCH /v1/appStoreVersions/{id}/relationships/build. Only builds uploaded to TestFlight with processingState=VALID can be attached. Changes apply only to an editable version (PREPARE_FOR_SUBMISSION, etc.). buildId comes from appstore_list_builds. When omitted, the latest VALID build is selected automatically — resolve appId from versionId → filter processingState=VALID only → highest buildNumber → attach (prevents mistakenly attaching a PROCESSING build). minBuildNumber sets a floor for automatic selection (e.g. only 1.4.x builds).',
  'App Store 버전 ID (appstore_list_versions 또는 appstore_create_version 결과)':
    'App Store version ID (from appstore_list_versions or appstore_create_version)',
  '빌드 ID (appstore_list_builds 결과). 생략 시 최신 VALID 빌드 자동 선택':
    'Build ID (from appstore_list_builds). When omitted, the latest VALID build is selected automatically',
  'buildId 생략 시 자동 선택 후보의 최소 buildNumber (예: 186 — 이전 빌드 무시)':
    'Minimum buildNumber for automatic-selection candidates when buildId is omitted (e.g. 186 — ignores earlier builds)',
  'App Store 버전 메타데이터 (설명문, 키워드, What\'s New)':
    'App Store version metadata (description, keywords, What\'s New)',
  '버전 ID':
    'Version ID',
  'App Store 버전 로컬라이제이션(메타데이터) 수정 — localizationId 직접 지정. 이 버전의 새로운 기능(whatsNew), 설명(description), 키워드, 프로모션 텍스트를 편집. 수정 가능한 상태(PREPARE_FOR_SUBMISSION 등)인 버전에서만 반영됨':
    'Update an App Store version localization (metadata) — by explicit localizationId. Edits this version\'s What\'s New (whatsNew), description, keywords, and promotional text. Applies only to a version in an editable state (PREPARE_FOR_SUBMISSION, etc.)',
  '로컬라이제이션 ID (appstore_get_metadata 결과의 id)':
    'Localization ID (the id from appstore_get_metadata)',
  '이 버전의 새로운 기능 (4000자 이내)':
    'What\'s New in this version (up to 4000 characters)',
  '앱 설명 (4000자 이내)':
    'App description (up to 4000 characters)',
  '키워드 (쉼표 구분, 100자 이내)':
    'Keywords (comma-separated, up to 100 characters)',
  '프로모션 텍스트 (170자 이내)':
    'Promotional text (up to 170 characters)',
  '지원 URL':
    'Support URL',
  '마케팅 URL':
    'Marketing URL',
  'App Store 로케일의 스크린샷 목록과 처리 상태를 조회한다. 첫 JSON은 기존 세트 배열이다. App Asset Library 배치가 있으면 두 번째 JSON에 표시한다.':
    'List the screenshots of an App Store locale and their processing state. The first JSON is the array of existing sets. If there are App Asset Library placements, they are shown in a second JSON.',
  'App Store 스크린샷을 업로드하거나 기존 Asset Library 에셋을 배치한다. Asset Library 방식은 placementGroup과 filePath 또는 assetId를 사용한다. 파일 경로는 로컬 절대경로다. Asset Library 결과가 processing이면 처리 완료 후 같은 assetId로 배치를 요청한다. 기존 세트 방식은 displayType과 filePath를 사용한다. displayType의 예: APP_IPHONE_69 (6.9", 1290x2796) / APP_IPHONE_67 (6.7", 1290x2796) / APP_IPHONE_65 (6.5", 1242x2688) / APP_IPHONE_61 (6.1", 1170x2532) / APP_IPHONE_58 (5.8") / APP_IPHONE_55 (5.5", 1242x2208) / APP_IPAD_PRO_3GEN_129 (13", 2064x2752) / APP_IPAD_PRO_3GEN_11 (11", 1668x2388) / APP_IPAD_PRO_129 (12.9", 2048x2732) / APP_DESKTOP (2560x1600+). 해상도 틀리면 검수에서 리젝됨. 수정 가능한 버전 상태에서만 반영됨.':
    'Upload an App Store screenshot or place an existing Asset Library asset. The Asset Library method uses placementGroup plus filePath or assetId. The file path is a local absolute path. If the Asset Library result is processing, request the placement again with the same assetId after processing completes. The existing-set method uses displayType and filePath. displayType examples: APP_IPHONE_69 (6.9", 1290x2796) / APP_IPHONE_67 (6.7", 1290x2796) / APP_IPHONE_65 (6.5", 1242x2688) / APP_IPHONE_61 (6.1", 1170x2532) / APP_IPHONE_58 (5.8") / APP_IPHONE_55 (5.5", 1242x2208) / APP_IPAD_PRO_3GEN_129 (13", 2064x2752) / APP_IPAD_PRO_3GEN_11 (11", 1668x2388) / APP_IPAD_PRO_129 (12.9", 2048x2732) / APP_DESKTOP (2560x1600+). A wrong resolution gets rejected in review. Applies only when the version is in an editable state.',
  '로컬라이제이션 ID':
    'Localization ID',
  '기존 세트 디스플레이 타입 (예: APP_IPHONE_69)':
    'Existing-set display type (e.g. APP_IPHONE_69)',
  'Asset Library 배치 그룹 (예: IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE)':
    'Asset Library placement group (e.g. IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE)',
  '업로드할 이미지 파일의 절대경로':
    'Absolute path of the image file to upload',
  '재사용할 Asset Library 이미지 ID':
    'Asset Library image ID to reuse',
  'App Store 개별 스크린샷 삭제':
    'Delete a single App Store screenshot',
  '기존 세트에 속한 스크린샷 ID (appstore_list_screenshots 첫 번째 결과)':
    'ID of a screenshot in an existing set (first result of appstore_list_screenshots)',
  'App Store 스크린샷 셋 전체 삭제 (디스플레이 타입 교체 시 먼저 정리)':
    'Delete an entire App Store screenshot set (clean up first when replacing a display type)',
  '기존 스크린샷 셋 ID (appstore_list_screenshots 첫 번째 결과)':
    'Existing screenshot set ID (first result of appstore_list_screenshots)',
  'App Store \'이 버전의 새로운 기능\' 편집 — versionId + locale만 주면 자동으로 로컬라이제이션을 찾아 PATCH. 가장 흔한 사용 케이스. 수정 가능한 상태(PREPARE_FOR_SUBMISSION 등)인 버전에서만 반영됨':
    'Edit App Store "What\'s New in This Version" — given only versionId + locale, finds the localization automatically and PATCHes it. The most common use case. Applies only to a version in an editable state (PREPARE_FOR_SUBMISSION, etc.)',
  '버전 ID (appstore_list_versions 결과)':
    'Version ID (from appstore_list_versions)',
  '로캘 (예: ko, en-US, ja)':
    'Locale (e.g. ko, en-US, ja)',
  '\'이 버전의 새로운 기능\' 텍스트 (4000자 이내)':
    '"What\'s New in This Version" text (up to 4000 characters)',
  'App Store 심사 리뷰어 노트(Notes for App Review) 등록/수정. versionId 버전에 appStoreReviewDetail.notes를 PATCH하거나 없으면 POST로 생성. 심사 시 리뷰어에게 전달되는 테스트 계정·기능 안내 텍스트 작성에 사용. 4000자 권장 한도.':
    'Create/update the App Review reviewer notes (Notes for App Review). PATCHes appStoreReviewDetail.notes on the versionId version, or creates it with POST if absent. Use to write the test account and feature guidance text passed to the reviewer during review. Recommended limit 4000 characters.',
  '리뷰어에게 전달할 메모 (테스트 계정, 주요 변경사항, 접근 방법 등). 4000자 이내.':
    'Notes for the reviewer (test account, key changes, how to access, etc.). Up to 4000 characters.',
  'App Store 심사 리뷰어 노트(Notes for App Review) 조회. 현재 등록된 notes, contactEmail 확인용.':
    'Get the App Review reviewer notes (Notes for App Review). Use to check the currently registered notes and contactEmail.',
  'TestFlight 빌드 목록':
    'List TestFlight builds',
  'TestFlight 베타 그룹 목록':
    'List TestFlight beta groups',
  'App Store 앱 정보 (카테고리, 연령 등급, state). state=READY_FOR_DISTRIBUTION이 라이브, 그 외가 편집 가능 appInfo.':
    'App Store app info (category, age rating, state). state=READY_FOR_DISTRIBUTION is live; any other is the editable appInfo.',
  '편집 가능한 appInfo의 로컬라이제이션 목록 조회 — 앱 이름(name), 부제(subtitle), 개인정보 URL/텍스트. appInfo.relationships.appInfoLocalizations가 빈 배열로 오는 케이스를 우회하려고 /appInfos/{id}/appInfoLocalizations 직접 호출. locale을 주면 해당 언어만 반환 (예: "ko", "en-US"). ※ versionLocalization(설명/키워드/whatsNew)과 다름 — 그건 appstore_get_metadata 사용.':
    'List the localizations of the editable appInfo — app name (name), subtitle, privacy URL/text. Calls /appInfos/{id}/appInfoLocalizations directly to work around cases where appInfo.relationships.appInfoLocalizations comes back as an empty array. Passing locale returns only that language (e.g. "ko", "en-US"). ※ Different from versionLocalization (description/keywords/whatsNew) — for that, use appstore_get_metadata.',
  '앱 ID (appstore_list_apps 결과)':
    'App ID (from appstore_list_apps)',
  '언어 필터 (예: "ko", "en-US"). 생략 시 전체 반환.':
    'Language filter (e.g. "ko", "en-US"). When omitted, returns all.',
  'appInfo 로컬라이제이션(앱 이름/부제/개인정보 URL/텍스트) 수정 — PATCH /appInfoLocalizations/{id}. localizationId는 appstore_list_app_info_localizations 결과의 id. 편집 가능 상태(PREPARE_FOR_SUBMISSION / DEVELOPER_REJECTED 등)에서만 반영됨. 제한: name 30자, subtitle 30자.':
    'Update an appInfo localization (app name/subtitle/privacy URL/text) — PATCH /appInfoLocalizations/{id}. localizationId is the id from appstore_list_app_info_localizations. Applies only in an editable state (PREPARE_FOR_SUBMISSION / DEVELOPER_REJECTED, etc.). Limits: name 30 characters, subtitle 30 characters.',
  '앱 이름 (30자 이내)':
    'App name (up to 30 characters)',
  '부제 (30자 이내)':
    'Subtitle (up to 30 characters)',
  '개인정보 처리방침 URL':
    'Privacy policy URL',
  '개인정보 처리방침 텍스트':
    'Privacy policy text',
  'appInfo 로컬라이제이션(스토어 언어) 추가 — POST /appInfoLocalizations. 편집 가능 appInfo를 자동으로 찾아 새 locale의 앱 이름/부제/개인정보 URL을 생성. 이미 존재하는 locale이면 409 DUPLICATE — 그땐 appstore_update_app_info_localization 사용. 생성하면 같은 locale의 버전 로컬라이제이션(설명/키워드/whatsNew)도 함께 생길 수 있음(2026-07 실측) — 내용 채우기는 appstore_update_localization. 제한: name 30자, subtitle 30자. locale 예: "en-US", "ja", "zh-Hans", "zh-Hant".':
    'Add an appInfo localization (store language) — POST /appInfoLocalizations. Finds the editable appInfo automatically and creates the app name/subtitle/privacy URL for the new locale. If the locale already exists, 409 DUPLICATE — use appstore_update_app_info_localization instead. Creating it may also create the version localization (description/keywords/whatsNew) for the same locale (observed 2026-07) — fill its content with appstore_update_localization. Limits: name 30 characters, subtitle 30 characters. locale examples: "en-US", "ja", "zh-Hans", "zh-Hant".',
  '추가할 언어 (예: "en-US", "ja", "zh-Hans", "zh-Hant")':
    'Language to add (e.g. "en-US", "ja", "zh-Hans", "zh-Hant")',
  'App Store 받은 고객 리뷰 조회 (최신순). response가 null이면 미답변입니다. 답변이 있으면 객체를 반환하고, 답변 상태를 확인할 수 없으면 response 필드를 생략합니다. territory(예: KOR/USA — ISO 3166 alpha-3) / rating(1~5)으로 필터 가능.':
    'List customer reviews received on the App Store (newest first). response null means unanswered. If there is a reply, an object is returned; if the reply state cannot be determined, the response field is omitted. Can filter by territory (e.g. KOR/USA — ISO 3166 alpha-3) / rating (1–5).',
  'App Store 앱 ID (appstore_list_apps 결과)':
    'App Store app ID (from appstore_list_apps)',
  '가져올 개수 (기본 50, 최대 200)':
    'Number to retrieve (default 50, max 200)',
  '국가 코드 (예: \'KOR\', \'USA\' — alpha-3)':
    'Country code (e.g. \'KOR\', \'USA\' — alpha-3)',
  '별점 필터 (1~5)':
    'Star rating filter (1–5)',
  'App Store 고객 리뷰에 개발자 답변을 등록 (또는 갱신). 동일 리뷰에 한 번만 답변 가능 — 기존 답변이 있으면 Apple이 새 응답으로 대체함. reviewId는 appstore_list_reviews 결과의 id. 답변 본문은 5970자 이내.':
    'Post (or update) a developer response to an App Store customer review. Only one response per review — if a response already exists, Apple replaces it with the new one. reviewId is the id from appstore_list_reviews. Response body up to 5970 characters.',
  '리뷰 ID (appstore_list_reviews 결과)':
    'Review ID (from appstore_list_reviews)',
  '답변 본문 (5970자 이내)':
    'Response body (up to 5970 characters)',
  'App Store에 일회성 인앱 구매(IAP)를 생성 — CONSUMABLE (소비성) / NON_CONSUMABLE (비소비성). 생성 후 App Store Connect에서 스크린샷·리뷰 노트를 추가해야 심사 제출 가능.':
    'Create a one-time in-app purchase (IAP) on the App Store — CONSUMABLE / NON_CONSUMABLE. After creation, screenshots and review notes must be added in App Store Connect before it can be submitted for review.',
  '상품 ID (글로벌 unique 권장: 예 com.example.coins_100)':
    'Product ID (globally unique recommended: e.g. com.example.coins_100)',
  '상품 이름 (스토어 노출, 최대 30자)':
    'Product name (shown in store, max 30 characters)',
  '가격 (최소 단위: USD cents. 예: $0.99 → 99, ₩1,100 → 1100)':
    'Price (minor unit: USD cents. e.g. $0.99 → 99, ₩1,100 → 1100)',
  'IAP 유형 (소비성/비소비성)':
    'IAP type (consumable/non-consumable)',
  'ISO 4217 통화 코드 (예: KRW)':
    'ISO 4217 currency code (e.g. KRW)',
  '번들 ID (appId 대신 사용 가능)':
    'Bundle ID (can be used instead of appId)',
  'App Store에 자동 갱신 구독을 생성 — Subscription Group 자동 생성 포함. 생성 후 App Store Connect에서 스크린샷·리뷰 노트를 추가해야 심사 제출 가능.':
    'Create an auto-renewable subscription on the App Store — includes automatic Subscription Group creation. After creation, screenshots and review notes must be added in App Store Connect before it can be submitted for review.',
  '구독 productId (예: com.example.premium.monthly)':
    'Subscription productId (e.g. com.example.premium.monthly)',
  '구독 이름 (스토어 노출)':
    'Subscription name (shown in store)',
  '가격 (최소 단위: USD cents. 예: $9.99 → 999, ₩9,900 → 9900)':
    'Price (minor unit: USD cents. e.g. $9.99 → 999, ₩9,900 → 9900)',
  '구독 주기':
    'Subscription period',
  'App Store의 모든 IAP 상품(구독 + 일회성) 통합 조회. productId / internalId / name / status / type 반환.':
    'List all App Store IAP products (subscriptions + one-time) together. Returns productId / internalId / name / status / type.',
  'App Store 앱 ID (숫자형, appstore_list_apps 결과)':
    'App Store app ID (numeric, from appstore_list_apps)',
  '기존 App Store IAP/구독 상품의 App Review 노트를 수정. appstore_list_products의 productId/type을 사용.':
    'Update the App Review note of an existing App Store IAP/subscription product. Uses productId/type from appstore_list_products.',
  '상품 ID (appstore_list_products 결과)':
    'Product ID (from appstore_list_products)',
  'Apple 심사용 노트 (4000자 이하, 빈 문자열은 초기화)':
    'Note for Apple review (4000 characters or fewer; an empty string clears it)',
  'App Store IAP/구독 상품의 현지화(표시 이름·설명) 목록 조회. locale / name / description / state 반환.':
    'List the localizations (display name, description) of an App Store IAP/subscription product. Returns locale / name / description / state.',
  'App Store IAP/구독 상품의 현지화(표시 이름·설명)를 로케일 단위로 upsert — 있으면 수정, 없으면 생성. 현지화가 비면 상품이 MISSING_METADATA 에서 안 풀려 심사에 넣을 수 없다 (리뷰 노트·스크린샷과는 별개 리소스). locale 은 App Store 표기(ko, en-US, ja, zh-Hant)를 쓴다. 길이 상한은 리소스마다 다르고 Apple 이 강제한다 — 구독은 실측으로 name 35 / description 55 다. 초과하면 Apple 이 "Max number of characters is (N)" 으로 실제 상한을 알려주므로 그 값에 맞춰 줄이면 된다. ⚠️ 심사 중인 상품은 현지화가 잠겨 UNMODIFIABLE 로 거부된다 — 결과를 기다리거나 철회 후 수정한다.':
    'Upsert the localization (display name, description) of an App Store IAP/subscription product per locale — updates it if it exists, creates it otherwise. With no localization the product stays stuck in MISSING_METADATA and cannot be put into review (a separate resource from the review note and screenshot). locale uses App Store notation (ko, en-US, ja, zh-Hant). Length limits differ per resource and are enforced by Apple — for subscriptions, observed limits are name 35 / description 55. If exceeded, Apple reports the actual limit as "Max number of characters is (N)", so shorten to that value. ⚠️ A product under review has its localizations locked and is rejected with UNMODIFIABLE — wait for the result, or withdraw it and then edit.',
  '로케일 (예: ko, en-US, ja, zh-Hant)':
    'Locale (e.g. ko, en-US, ja, zh-Hant)',
  '표시 이름. 새 로케일 생성 시 필수 (구독 실측 상한 35자)':
    'Display name. Required when creating a new locale (observed limit for subscriptions: 35 characters)',
  '설명. 생략하면 기존 값 유지 (구독 실측 상한 55자)':
    'Description. When omitted, the existing value is kept (observed limit for subscriptions: 55 characters)',
  '기존 App Store IAP/구독 상품의 심사용 스크린샷을 reserve → upload → commit. 상품당 1장, 절대 파일 경로 필요. 이미 있으면 409 "Screenshot already exists" — 갈아끼우려면 replace: true (기존 것을 지우고 올린다).':
    'Reserve → upload → commit the review screenshot of an existing App Store IAP/subscription product. One per product; an absolute file path is required. If one already exists, 409 "Screenshot already exists" — to swap it, pass replace: true (deletes the existing one and uploads).',
  '업로드할 PNG/JPG의 절대 파일 경로':
    'Absolute file path of the PNG/JPG to upload',
  '이미 스크린샷이 있으면 지우고 새로 올린다 (기본 false)':
    'If a screenshot already exists, delete it and upload anew (default false)',
  'App Store IAP/구독 상품을 **단독으로** 심사에 제출한다 — consumable/non_consumable 은 POST /v1/inAppPurchaseSubmissions, subscription 은 POST /v1/subscriptionSubmissions. ⚠️ 호출 즉시 제출된다 ("묶음에 담기"가 아니다 — 그런 공개 API 는 존재하지 않는다. reviewSubmissionItems 는 appStoreVersion 계열 관계만 받는다, 2026-07 실측). 이미 승인된 적 있는 상품의 변경분 제출용. **앱 첫 심사** 상품은 Apple 이 "no pending version" 409 로 거부한다 — 그 경우 ASC 웹 버전 페이지의 "앱 내 구입 및 구독" 섹션에서 담아 버전과 함께 제출해야 한다 (도구가 에러에 안내 첨부). 상품 상태가 READY_TO_SUBMIT 이어야 한다 (MISSING_METADATA 면 appstore_update_product_localization 먼저).':
    'Submit an App Store IAP/subscription product to review **on its own** — consumable/non_consumable via POST /v1/inAppPurchaseSubmissions, subscription via POST /v1/subscriptionSubmissions. ⚠️ Submits immediately when called (it does not "add to a bundle" — no such public API exists; reviewSubmissionItems accepts only appStoreVersion-type relationships, observed 2026-07). For submitting changes to a product that has been approved before. For a product in the **app\'s first review**, Apple rejects with a "no pending version" 409 — in that case it must be added in the "In-App Purchases and Subscriptions" section of the version page on the ASC web and submitted together with the version (the tool attaches guidance to the error). The product state must be READY_TO_SUBMIT (if MISSING_METADATA, call appstore_update_product_localization first).',
  'App Store 심사 제출 묶음(reviewSubmissions) + 내부 항목 조회 — 읽기 전용. 각 묶음의 state(READY_FOR_REVIEW=초안 / WAITING_FOR_REVIEW=큐 / UNRESOLVED_ISSUES=거절 미해결 / COMPLETE) 와 항목별 state·연결 리소스(appStoreVersion 이면 versionString 포함)를 보여준다. 재제출이 "appStoreVersions ... is not in valid state" 로 막힐 때 첫 번째로 볼 것 — 진범은 대개 UNRESOLVED_ISSUES 묶음이 버전을 REJECTED 항목으로 물고 있는 것이다 (버전 자체는 PREPARE_FOR_SUBMISSION 으로 멀쩡해 보인다, 2026-07 실측). 해제는 appstore_remove_review_submission_item.':
    'List App Store review submission bundles (reviewSubmissions) + their items — read-only. Shows each bundle\'s state (READY_FOR_REVIEW=draft / WAITING_FOR_REVIEW=queued / UNRESOLVED_ISSUES=rejection unresolved / COMPLETE) and each item\'s state and linked resource (including versionString for an appStoreVersion). The first thing to check when a resubmission is blocked with "appStoreVersions ... is not in valid state" — the culprit is usually an UNRESOLVED_ISSUES bundle holding the version as a REJECTED item (the version itself looks fine in PREPARE_FOR_SUBMISSION, observed 2026-07). Release it with appstore_remove_review_submission_item.',
  '조회할 묶음 수 (기본 5, 최신순)':
    'Number of bundles to list (default 5, newest first)',
  '심사 제출 묶음에서 항목을 제거한다 (removed=true PATCH) — ASC 웹 "재제출" 버튼이 내부적으로 하는 동작. 거절된 옛 묶음(UNRESOLVED_ISSUES)이 버전을 물고 있어 재제출이 ENTITY_STATE_INVALID 로 막힐 때 해제용. 항목이 풀리면 옛 묶음은 COMPLETE 로 정리된다. itemId 는 appstore_list_review_submissions 결과. (appstore_submit_for_review 는 이 해제를 자동으로 시도한다 — 수동 개입이 필요할 때만 직접 호출.)':
    'Remove an item from a review submission bundle (removed=true PATCH) — what the ASC web "Resubmit" button does internally. Used to release a version held by an old rejected bundle (UNRESOLVED_ISSUES) when resubmission is blocked with ENTITY_STATE_INVALID. Once the item is released, the old bundle is cleaned up to COMPLETE. itemId comes from appstore_list_review_submissions. (appstore_submit_for_review attempts this release automatically — call this directly only when manual intervention is needed.)',
  'reviewSubmissionItem ID (appstore_list_review_submissions 결과)':
    'reviewSubmissionItem ID (from appstore_list_review_submissions)',
  '이미 존재하는 심사 묶음에 앱 버전을 항목으로 추가한다 (POST /reviewSubmissionItems). ⚠️ 앱 첫 심사 필수 절차 — 웹에서 IAP/구독을 담으면 "상품만 든 묶음"이 새로 생기는데, 그대로 제출하면 409 "an appStoreVersions must be included in this review submission" 로 막힌다. reviewSubmissionItems 는 상품 관계는 거부하지만 appStoreVersion 관계는 받으므로, 버전을 이 묶음으로 옮기면 된다. 버전이 다른 묶음에 물려 있으면 먼저 풀 것: 미제출 묶음이면 appstore_remove_review_submission_item, 제출된 묶음이면 항목 제거가 막히므로 appstore_cancel_review 로 묶음째 취소. 추가 후 appstore_submit_for_review 로 제출하면 버전+상품이 한 묶음으로 나간다.':
    'Add an app version as an item to an existing review submission bundle (POST /reviewSubmissionItems). ⚠️ Required step for an app\'s first review — adding IAPs/subscriptions on the web creates a new "products-only bundle", and submitting it as is gets blocked with 409 "an appStoreVersions must be included in this review submission". reviewSubmissionItems rejects product relationships but accepts the appStoreVersion relationship, so move the version into this bundle. If the version is held by another bundle, release it first: for an unsubmitted bundle, appstore_remove_review_submission_item; for a submitted bundle, item removal is blocked, so cancel the whole bundle with appstore_cancel_review. After adding, submit with appstore_submit_for_review and the version + products go out as one bundle.',
  '대상 reviewSubmission ID (appstore_list_review_submissions 결과)':
    'Target reviewSubmission ID (from appstore_list_review_submissions)',
  '추가할 App Store 버전 ID (appstore_list_versions 결과)':
    'App Store version ID to add (from appstore_list_versions)',
  '기존 App Store 버전 레코드의 versionString 을 변경 (예: 2.0.5 → 2.0.6). ⚠️ 편집 가능한 버전이 이미 있으면 appstore_create_version 이 409 "cannot create a new version in the current state" 로 막힌다 — 거절/철회된 버전으로 다음 릴리스를 내보내려면 새로 만들지 말고 이 도구로 **같은 레코드의 이름을 올린다**. 빌드는 CFBundleShortVersionString 이 같은 버전에만 붙으므로, 새 버전의 빌드를 attach 하려면 먼저 이걸 맞춰야 한다. PREPARE_FOR_SUBMISSION / DEVELOPER_REJECTED 등 편집 가능 상태에서만 통한다.':
    'Change the versionString of an existing App Store version record (e.g. 2.0.5 → 2.0.6). ⚠️ If an editable version already exists, appstore_create_version is blocked with 409 "cannot create a new version in the current state" — to ship the next release from a rejected/withdrawn version, do not create a new one; use this tool to **bump the name of the same record**. A build attaches only to a version with the same CFBundleShortVersionString, so to attach a new version\'s build, align this first. Works only in an editable state such as PREPARE_FOR_SUBMISSION / DEVELOPER_REJECTED.',
  'App Store 버전 ID (appstore_list_versions 결과)':
    'App Store version ID (from appstore_list_versions)',
  '새 버전 문자열 (예: "2.0.6")':
    'New version string (e.g. "2.0.6")',
  'App Store IAP 상품의 reference name 변경. productId / 유형은 변경 불가. 스토어에 보이는 표시 이름·설명은 appstore_update_product_localization 을 쓴다.':
    'Change the reference name of an App Store IAP product. productId / type cannot be changed. For the display name and description shown in the store, use appstore_update_product_localization.',
  '새 reference name':
    'New reference name',
  '⚠️ 비가역. App Store IAP 상품 삭제. MISSING_METADATA / WAITING_FOR_REVIEW 상태만 가능 — 이미 승인(READY_FOR_SALE)된 상품은 Console에서 "Remove from sale" 해야 함.':
    '⚠️ Irreversible. Delete an App Store IAP product. Only possible in MISSING_METADATA / WAITING_FOR_REVIEW state — an already approved (READY_FOR_SALE) product must be "Remove from sale" in the Console.',
  'App Store 배포 플랜 — 편집 가능한 버전/빌드 attach/메타/스크린샷/정책 위험을 한 번에 점검하고 체크리스트로 반환합니다 (read-only). ⚠️ AI 호출자 지시: 응답의 미완료 항목을 반드시 TodoWrite로 사용자에게 먼저 보여주고, 사용자 동의 후 단계별로 기존 도구(appstore_update_localization, appstore_update_whats_new, appstore_submit_for_review 등)를 호출하세요. submit_for_review는 비가역이므로 반드시 명시 동의 필요.':
    'App Store release plan — checks the editable version, build attach, metadata, screenshots, and policy risks in one pass and returns a checklist (read-only). ⚠️ Instruction for the AI caller: you must first show the incomplete items in the response to the user via TodoWrite, and after the user agrees, call the existing tools step by step (appstore_update_localization, appstore_update_whats_new, appstore_submit_for_review, etc.). submit_for_review is irreversible, so it always requires the user\'s explicit approval.',
  'App Store 앱 ID (appstore_list_apps 결과의 id)':
    'App Store app ID (the id from appstore_list_apps)',
  '대상 버전 문자열 (예: 1.3.0)':
    'Target version string (e.g. 1.3.0)',
  '정확한 버전 ID (appstore_list_versions 결과)':
    'Exact version ID (from appstore_list_versions)',
  '앱이 소셜 피드·UGC 확산 기능을 제공하는지에 대한 프로젝트 사실':
    'Project fact: whether the app provides social feed / UGC distribution features',
  '소셜 미디어 기능이 13세 미만에게 비활성화되는지에 대한 프로젝트 사실':
    'Project fact: whether social media features are disabled for users under 13',
  'App Store 버전을 심사에 제출 — 새 reviewSubmissions API 사용 (옛 /appStoreVersionSubmissions는 2024-01 deprecated). 내부 흐름: POST /reviewSubmissions(또는 CREATED 상태 재사용) → POST /reviewSubmissionItems(version attach) → PATCH submitted=true. appId와 platform은 versionId에서 자동 조회 — 별도 입력 불필요. ⚠️ 비가역 작업: 제출 후엔 Apple 심사가 시작되며, 메타데이터/스크린샷/빌드를 더 못 바꿈 (REJECTED/METADATA_REJECTED 시 다시 편집 가능). 안전 가드: confirm 생략/false 시 dry-run preview 만 반환 (versionString·빌드·whatsNew 발췌). 실제 제출은 confirm: true 로 재호출. 사전 조건: 버전이 PREPARE_FOR_SUBMISSION 또는 DEVELOPER_REJECTED 상태, 빌드 attached, 모든 필수 메타데이터 채워짐. 거절된 옛 묶음(UNRESOLVED_ISSUES)이 버전을 물고 있어 attach 가 막히면 자동으로 항목을 해제(removed=true)하고 재시도한다 — 진단은 appstore_list_review_submissions. appstore_check_submission_risks로 사전 점검 권장.':
    'Submit an App Store version for review — uses the new reviewSubmissions API (the old /appStoreVersionSubmissions was deprecated 2024-01). Internal flow: POST /reviewSubmissions (or reuse one in CREATED state) → POST /reviewSubmissionItems (version attach) → PATCH submitted=true. appId and platform are looked up automatically from versionId — no separate input needed. ⚠️ Irreversible: after submission Apple review starts, and metadata/screenshots/build can no longer be changed (editable again on REJECTED/METADATA_REJECTED). Safety guard: when confirm is omitted/false, returns only a dry-run preview (versionString, build, whatsNew excerpt). To actually submit, call again with confirm: true. Preconditions: version in PREPARE_FOR_SUBMISSION or DEVELOPER_REJECTED state, build attached, all required metadata filled. If an old rejected bundle (UNRESOLVED_ISSUES) holds the version and blocks the attach, it automatically releases the item (removed=true) and retries — diagnose with appstore_list_review_submissions. Pre-checking with appstore_check_submission_risks is recommended.',
  'true 명시 시에만 실제 심사 제출. 생략/false 면 dry-run preview 만 반환 (비가역 사고 차단).':
    'Actually submits for review only when explicitly true. When omitted/false, returns only a dry-run preview (prevents irreversible accidents).',
  'App Store 심사 제출을 철회 — WAITING_FOR_REVIEW 상태에서만 가능. PATCH attributes.canceled=true → state 가 CANCELING 으로 바뀌고 수십 초 뒤 COMPLETE(항목 REMOVED), 버전은 편집 가능 상태로 복귀해 메타데이터/빌드 수정 가능. CANCELING 은 비동기라 호출 직후엔 아직 COMPLETE 가 아니다 — 이어서 작업하려면 상태를 폴링할 것. ⚠️ IN_REVIEW 이상이면 Apple API가 409로 거부함 — 이 경우 App Store Connect 웹에서 직접 처리하거나 심사 결과를 기다려야 함. 제출된 묶음에서 항목만 빼내는 것(removed)은 막히므로, 버전을 다른 묶음으로 옮기려면 이 도구로 묶음째 취소한다. 철회 후 수정 완료 시 appstore_submit_for_review로 재제출 가능.':
    'Withdraw an App Store review submission — only possible in WAITING_FOR_REVIEW state. PATCH attributes.canceled=true → state changes to CANCELING, then after tens of seconds to COMPLETE (items REMOVED), and the version returns to an editable state so metadata/build can be changed. CANCELING is asynchronous, so right after the call it is not yet COMPLETE — poll the state before continuing. ⚠️ At IN_REVIEW or later, the Apple API rejects with 409 — in that case handle it directly on the App Store Connect web or wait for the review result. Pulling just an item out of a submitted bundle (removed) is blocked, so to move a version to another bundle, cancel the whole bundle with this tool. After withdrawing and finishing edits, resubmit with appstore_submit_for_review.',
  '버전의 출시 상태를 한 번에 읽는다 — 읽기 전용. appStoreState(PENDING_DEVELOPER_RELEASE / READY_FOR_SALE …), releaseType(MANUAL / AFTER_APPROVAL / SCHEDULED), earliestReleaseDate, 그리고 단계적 출시가 켜져 있으면 그 상태(ACTIVE/PAUSED/COMPLETE)와 현재 며칠째인지. 출시 관련 쓰기 도구를 부르기 전에 이걸로 먼저 확인할 것.':
    'Read a version\'s release status in one call — read-only. appStoreState (PENDING_DEVELOPER_RELEASE / READY_FOR_SALE …), releaseType (MANUAL / AFTER_APPROVAL / SCHEDULED), earliestReleaseDate, and, if phased release is on, its state (ACTIVE/PAUSED/COMPLETE) and which day it is on. Check this first before calling any release-related write tool.',
  '심사를 통과해 개발자 출시 대기(PENDING_DEVELOPER_RELEASE) 중인 버전을 지금 출시한다 — POST /v1/appStoreVersionReleaseRequests. 콘솔의 "이 버전 출시" 버튼과 같은 동작. ⚠️ 비가역: 실행 즉시 App Store 에 공개된다. 되돌리려면 새 버전을 내거나 판매 중단해야 한다. 안전 가드: confirm 생략/false 면 현재 상태만 보여주는 dry-run. releaseType=AFTER_APPROVAL 로 만든 버전은 승인 시 자동 출시되므로 이 도구가 필요 없다 — MANUAL 로 대기 중인 버전용이다.':
    'Release now a version that passed review and is waiting for developer release (PENDING_DEVELOPER_RELEASE) — POST /v1/appStoreVersionReleaseRequests. Same as the console\'s "Release This Version" button. ⚠️ Irreversible: it goes public on the App Store immediately. Undoing it requires shipping a new version or removing it from sale. Safety guard: when confirm is omitted/false, a dry-run that only shows the current state. A version created with releaseType=AFTER_APPROVAL is released automatically on approval and does not need this tool — it is for versions waiting as MANUAL.',
  'true 명시 시에만 실제 출시. 생략/false 면 dry-run.':
    'Actually releases only when explicitly true. When omitted/false, dry-run.',
  '이미 만들어진 버전의 출시 방식을 바꾼다 — PATCH /v1/appStoreVersions/{id}. MANUAL(개발자가 직접 출시) / AFTER_APPROVAL(승인되면 자동 출시) / SCHEDULED(지정 시각 출시). SCHEDULED 는 earliestReleaseDate(ISO 8601, 미래 시각)가 함께 필요하다. 편집 가능한 상태에서만 통한다 — 이미 READY_FOR_SALE 이면 바꿀 수 없다. MANUAL 로 만들어 둔 버전을 "승인되면 알아서 나가게" 바꾸는 용도가 대부분이다.':
    'Change the release type of an already created version — PATCH /v1/appStoreVersions/{id}. MANUAL (developer releases manually) / AFTER_APPROVAL (released automatically once approved) / SCHEDULED (released at a set time). SCHEDULED also requires earliestReleaseDate (ISO 8601, a future time). Works only in an editable state — cannot be changed once READY_FOR_SALE. Mostly used to switch a version created as MANUAL to "go out on its own once approved".',
  'App Store 버전 ID':
    'App Store version ID',
  '출시 방식':
    'Release type',
  'SCHEDULED 일 때 필수. ISO 8601 UTC (예: 2026-08-01T09:00:00Z)':
    'Required when SCHEDULED. ISO 8601 UTC (e.g. 2026-08-01T09:00:00Z)',
  'iOS 단계적 출시(7일 램프)를 제어한다 — appStoreVersionPhasedReleases. action: status(조회) / enable(켜기·PAUSED면 재개) / pause(일시중지) / resume(재개) / complete(즉시 전체 공개) / disable(단계적 출시 제거). Play 의 userFraction·halted 에 해당하는 iOS 쪽 장치다. ⚠️ complete 와 disable 은 남은 사용자 전체에게 즉시 공개되며 되돌릴 수 없다 — confirm: true 필요. pause/resume/enable 은 되돌릴 수 있어 confirm 없이 실행된다.':
    'Control iOS phased release (7-day ramp) — appStoreVersionPhasedReleases. action: status (read) / enable (turn on; resumes if PAUSED) / pause / resume / complete (release to everyone immediately) / disable (remove phased release). The iOS counterpart of Play\'s userFraction/halted. ⚠️ complete and disable release to all remaining users immediately and cannot be undone — requires confirm: true. pause/resume/enable are reversible and run without confirm.',
  '수행할 동작':
    'Action to perform',
  'complete / disable 에만 필요. 생략/false 면 현재 상태만 반환하는 dry-run.':
    'Needed only for complete / disable. When omitted/false, a dry-run that returns only the current state.',
  '앱의 연령 등급 설문(ageRatingDeclaration) 현재 값을 읽는다 — 읽기 전용. appInfo 에 딸린 단일 리소스이며, 편집 가능한 appInfo 를 자동으로 고른다. 수정 전에 이걸로 현재 답변을 먼저 확인할 것.':
    'Read the current values of the app\'s age rating questionnaire (ageRatingDeclaration) — read-only. A single resource attached to appInfo; the editable appInfo is picked automatically. Check the current answers with this first before updating.',
  '연령 등급 설문을 갱신한다 — PATCH /v1/ageRatingDeclarations/{id}. 넘긴 필드만 바뀐다 (부분 갱신). 전체를 다시 보낼 필요 없다. 미완성이면 심사 제출이 막히므로 첫 출시 전 반드시 채워야 한다. Play 의 콘텐츠 등급 설문과 달리 Apple 은 이렇게 API 로 답변할 수 있다.':
    'Update the age rating questionnaire — PATCH /v1/ageRatingDeclarations/{id}. Only the fields passed are changed (partial update); no need to resend everything. If incomplete, review submission is blocked, so it must be filled before the first release. Unlike Play\'s content rating questionnaire, Apple lets you answer it via the API like this.',
  '만화/판타지 폭력 — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE':
    'Cartoon/fantasy violence — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE',
  '사실적 폭력 — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE':
    'Realistic violence — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE',
  '지속적·잔혹한 사실적 폭력 — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE':
    'Prolonged, graphic, or sadistic realistic violence — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE',
  '욕설/저속한 유머 — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE':
    'Profanity/crude humor — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE',
  '성인/암시적 주제 — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE':
    'Mature/suggestive themes — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE',
  '공포/공포 유발 주제 — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE':
    'Horror/fear themes — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE',
  '성적 콘텐츠 또는 노출 — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE':
    'Sexual content or nudity — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE',
  '노골적 성적 콘텐츠·노출 — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE':
    'Graphic sexual content and nudity — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE',
  '음주/흡연/약물 — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE':
    'Alcohol/tobacco/drug use or references — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE',
  '의료/치료 정보 — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE':
    'Medical/treatment information — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE',
  '모의 도박 — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE':
    'Simulated gambling — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE',
  '경품/콘테스트 — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE':
    'Contests — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE',
  '총기·무기 — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE':
    'Guns or other weapons — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE',
  '실제 도박 포함 여부':
    'Whether it includes real gambling',
  '확률형 아이템(루트박스) 포함 여부':
    'Whether it includes loot boxes',
  '제한 없는 웹 접근':
    'Unrestricted web access',
  '사용자 생성 콘텐츠':
    'User-generated content',
  'UGC를 피드·탐색 방식으로 재배포·확산·상호작용하는 소셜 미디어 기능':
    'Social media features that redistribute, spread, or interact with UGC through feeds or discovery',
  '소셜 미디어 기능을 13세 미만 사용자에게 비활성화':
    'Social media features disabled for users under 13',
  '메시지/채팅 기능':
    'Messaging/chat features',
  '광고 포함':
    'Contains advertising',
  '건강/웰니스 주제':
    'Health/wellness topics',
  '자녀 보호 기능 제공':
    'Provides parental controls',
  '연령 확인 장치 제공':
    'Provides age assurance',
  '키즈 카테고리 대상 연령대 (키즈 앱만)':
    'Kids category target age band (kids apps only)',
  '산출 등급을 더 높게 덮어쓸 때만':
    'Only when overriding the computed rating to a higher one',
  '한국 등급 별도 지정 (게임물관리위원회 등급을 반영해야 할 때)':
    'Separately set the Korea rating (when the Game Rating and Administration Committee rating must be reflected)',
  '등급 근거 안내 URL':
    'URL explaining the rating rationale',
  '수출 규정(암호화) 선언을 만들고 선택한 빌드에 연결한다 — POST /v1/appEncryptionDeclarations. Info.plist 의 ITSAppUsesNonExemptEncryption 이 있으면 보통 이 선언이 필요 없다 — 그게 없어서 ASC 가 "수출 규정 정보 누락"으로 제출을 막을 때 쓰는 경로다. ⚠️ 법적 신고 성격의 선언이다. 값은 반드시 사용자에게 확인받고 넣을 것.':
    'Create an export compliance (encryption) declaration and attach it to the selected builds — POST /v1/appEncryptionDeclarations. If Info.plist has ITSAppUsesNonExemptEncryption, this declaration is usually not needed — this is the path for when it is missing and ASC blocks submission with "Missing Compliance". ⚠️ The declaration is a legal filing in nature. The values must be confirmed with the user before you enter them.',
  '앱이 사용하는 암호화에 대한 설명 (심사용)':
    'Description of the encryption the app uses (for review)',
  '자체 개발한 암호화를 포함하는가':
    'Whether it contains proprietary cryptography',
  '서드파티 암호화를 포함하는가':
    'Whether it contains third-party cryptography',
  '프랑스 스토어에 배포하는가 (프랑스는 별도 신고 규정)':
    'Whether it is distributed on the French store (France has separate declaration rules)',
  '이 선언을 연결할 빌드 ID들 (appstore_list_builds 결과). 생략 시 선언만 생성':
    'Build IDs to attach this declaration to (from appstore_list_builds). When omitted, only the declaration is created',
  '앱의 판매 지역 상태를 읽는다 — GET /v1/apps/{id}/appAvailabilityV2. 판매 중/중지 지역 수와 신규 지역 자동 포함 여부를 보여준다. includeTerritories=true 면 지역별 행(id·available·releaseDate)까지 — 이 id 가 변경 도구의 입력이다.':
    'Read the app\'s territory availability — GET /v1/apps/{id}/appAvailabilityV2. Shows the number of territories on sale/not on sale and whether new territories are included automatically. With includeTerritories=true, also per-territory rows (id, available, releaseDate) — this id is the input to the change tool.',
  '지역 목록까지 반환 (기본 false)':
    'Also return the territory list (default false)',
  '지역별 판매 여부·출시일을 바꾼다 — PATCH /v1/territoryAvailabilities/{id}. id 는 appstore_get_availability(includeTerritories=true) 결과에서 가져올 것 — 지역 코드를 추측해 넣지 말 것. 한 지역이 실패해도 나머지는 계속 진행하고, 지역별 성공/실패를 그대로 보고한다. ⚠️ available=false 는 그 지역에서 앱을 내리는 동작이다.':
    'Change per-territory availability and release date — PATCH /v1/territoryAvailabilities/{id}. Take the id from the appstore_get_availability(includeTerritories=true) result — do not guess territory codes. If one territory fails, the rest still proceed, and per-territory success/failure is reported as is. ⚠️ available=false removes the app from that territory.',
  '변경할 지역 목록':
    'Territories to change',
  'territoryAvailability 리소스 id':
    'territoryAvailability resource id',
  '판매 여부':
    'Whether available for sale',
  '출시일 (YYYY-MM-DD)':
    'Release date (YYYY-MM-DD)',
  '사전주문 활성화':
    'Enable pre-order',
  'true 명시 시에만 실제 변경. 생략/false 면 변경 예정 목록만 반환.':
    'Actually changes only when explicitly true. When omitted/false, returns only the list of pending changes.',
  'TestFlight 외부 테스트 제출 전 점검 — 읽기 전용. 빌드의 internal/external 상태, 베타 심사 제출 상태, What to Test 가 채워진 로케일을 보여준다. appId 를 함께 주면 앱 단위 항목(베타 심사 연락처·데모 계정, 테스트 정보 로케일)까지 검사해 빠진 필드를 알려준다. 외부 배포가 막히면 여기부터 본다 — 대부분 수출 규정 미선언이나 심사 정보 공란이다.':
    'Check before submitting for TestFlight external testing — read-only. Shows the build\'s internal/external state, beta review submission state, and the locales with What to Test filled. With appId, also checks app-level items (beta review contact and demo account, test information locales) and reports missing fields. Start here when external distribution is blocked — most often it is an undeclared export compliance or blank review information.',
  '빌드 ID (appstore_list_builds 결과)':
    'Build ID (from appstore_list_builds)',
  '앱 ID — 주면 앱 단위 항목까지 함께 점검':
    'App ID — when passed, app-level items are checked as well',
  'TestFlight 베타 심사 정보(연락처·데모 계정·심사 노트)를 채운다 — PATCH /v1/betaAppReviewDetails/{id}. 앱 단위 단일 리소스이며 외부 테스트 심사 제출 전 필수다. 넘긴 필드만 바뀐다. 로그인이 필요한 앱이면 demoAccountRequired=true 와 계정/비밀번호를 반드시 함께 넣는다 — 없으면 반려된다.':
    'Fill in TestFlight beta review information (contact, demo account, review notes) — PATCH /v1/betaAppReviewDetails/{id}. A single app-level resource, required before submitting for external testing review. Only the fields passed are changed. If the app requires sign-in, you must pass demoAccountRequired=true together with the account/password — otherwise it is rejected.',
  '심사 연락처 이름':
    'Review contact first name',
  '심사 연락처 성':
    'Review contact last name',
  '심사 연락처 전화번호':
    'Review contact phone number',
  '심사 연락처 이메일':
    'Review contact email',
  '심사에 데모 계정이 필요한가':
    'Whether review requires a demo account',
  '데모 계정 ID':
    'Demo account ID',
  '데모 계정 비밀번호':
    'Demo account password',
  '심사자에게 남길 메모':
    'Notes for the reviewer',
  'TestFlight 테스트 정보(피드백 이메일·앱 설명 등)를 로케일별로 저장한다 — betaAppLocalizations upsert. 해당 로케일이 있으면 PATCH, 없으면 POST 한다. 외부 테스트에는 feedbackEmail 과 description 이 필요하다.':
    'Save TestFlight test information (feedback email, app description, etc.) per locale — betaAppLocalizations upsert. PATCHes if the locale exists, otherwise POSTs. External testing requires feedbackEmail and description.',
  '로케일 (예: ko, en-US)':
    'Locale (e.g. ko, en-US)',
  '테스터 피드백 수신 이메일':
    'Email that receives tester feedback',
  '테스터에게 보여줄 앱 설명':
    'App description shown to testers',
  '개인정보처리방침 URL':
    'Privacy policy URL',
  '빌드의 What to Test 를 로케일별로 저장한다 — betaBuildLocalizations upsert. 외부 테스터 배포에는 필수다. 비어 있으면 베타 심사에서 막힌다. 버전 릴리스 노트(appstore_update_whats_new)와는 별개다 — 이건 TestFlight 전용이다.':
    'Save a build\'s What to Test per locale — betaBuildLocalizations upsert. Required for distribution to external testers. If empty, beta review is blocked. Separate from the version release notes (appstore_update_whats_new) — this is TestFlight-only.',
  '빌드 ID':
    'Build ID',
  '이번 빌드에서 테스트할 내용':
    'What to test in this build',
  '빌드를 TestFlight 베타 심사에 제출한다 — POST /v1/betaAppReviewSubmissions. 외부 테스터에게 배포하려면 이 심사를 통과해야 한다 (내부 테스터는 불필요). 사전 조건: 외부 상태가 READY_FOR_BETA_SUBMISSION, What to Test 채움, 베타 심사 정보 채움. appstore_beta_status 로 먼저 점검할 것. confirm 생략/false 면 현재 상태만 보여주는 dry-run.':
    'Submit a build to TestFlight beta review — POST /v1/betaAppReviewSubmissions. Distributing to external testers requires passing this review (not needed for internal testers). Preconditions: external state is READY_FOR_BETA_SUBMISSION, What to Test filled, beta review information filled. Check with appstore_beta_status first. When confirm is omitted/false, a dry-run that only shows the current state.',
  '앱 ID — dry-run 점검을 앱 단위 항목까지 확장':
    'App ID — extends the dry-run check to app-level items',
  'true 명시 시에만 실제 제출':
    'Actually submits only when explicitly true',
  '베타 그룹에 빌드를 붙이거나 뗀다 — POST/DELETE /v1/betaGroups/{id}/relationships/builds. ⚠️ 외부 그룹에 붙이는 것은 **실제 배포**다 (심사 통과 후에만 가능). 떼면 테스터가 더 이상 받지 못한다. groupId 는 appstore_list_beta_groups 결과. confirm 생략/false 면 dry-run.':
    'Attach a build to or detach it from a beta group — POST/DELETE /v1/betaGroups/{id}/relationships/builds. ⚠️ Attaching to an external group is an **actual distribution** (only possible after passing review). Detaching means testers no longer receive it. groupId comes from appstore_list_beta_groups. When confirm is omitted/false, dry-run.',
  '베타 그룹 ID':
    'Beta group ID',
  '붙이기 / 떼기':
    'Attach / detach',
  'true 명시 시에만 실행':
    'Executes only when explicitly true',
  '베타 그룹에 테스터를 초대한다 — POST /v1/betaTesters. 이메일별로 개별 호출하며, 이미 등록된 주소는 실패로 표시하고 나머지는 계속 진행한다. ⚠️ 초대 메일이 즉시 발송된다 — 주소를 사용자에게 확인받고 실행할 것. confirm 필요.':
    'Invite testers to a beta group — POST /v1/betaTesters. Calls once per email; an already registered address is marked as failed and the rest continue. ⚠️ Invitation emails are sent immediately — confirm the addresses with the user before running. Requires confirm.',
  '베타 그룹 ID (appstore_list_beta_groups 결과)':
    'Beta group ID (from appstore_list_beta_groups)',
  '초대할 테스터 목록':
    'Testers to invite',
  '테스터 이메일':
    'Tester email',
  'true 명시 시에만 초대 발송':
    'Sends invitations only when explicitly true',
  '이미 배포된 빌드에 대해 테스터에게 알림을 다시 보낸다 — POST /v1/buildBetaNotifications. 자동 알림(autoNotifyEnabled)이 꺼져 있거나, 배포 후 다시 알리고 싶을 때. ⚠️ 테스터 전원에게 푸시/메일이 나간다. confirm 필요.':
    'Re-send a notification to testers for an already distributed build — POST /v1/buildBetaNotifications. For when automatic notification (autoNotifyEnabled) is off, or you want to notify again after distribution. ⚠️ A push/email goes to every tester. Requires confirm.',
  'true 명시 시에만 발송':
    'Sends only when explicitly true',
  '버전 로케일의 미리보기 동영상 목록. 기존 세트와 App Asset Library 배치를 조회한다. 각 동영상의 처리 상태와 포스터 프레임을 보여준다. 업로드 직후 인코딩이 끝났는지 확인할 때도 이걸 쓴다.':
    'List the preview videos of a version locale. Reads both existing sets and App Asset Library placements. Shows each video\'s processing state and poster frame. Also use this to check whether encoding has finished right after upload.',
  'appStoreVersionLocalization ID (appstore_get_metadata 결과의 로케일별 id)':
    'appStoreVersionLocalization ID (the per-locale id from appstore_get_metadata)',
  '제품 페이지 미리보기 동영상을 업로드하거나 기존 Asset Library 동영상을 배치한다. Asset Library 방식은 placementGroup과 filePath 또는 assetId를 사용한다. 기존 세트 방식은 previewType과 filePath를 사용한다. Asset Library 결과가 processing이면 인코딩 완료 후 같은 assetId로 배치를 요청한다. 저장한 배치는 appstore_list_previews로 확인한다. Apple 제약: 길이 15~30초, previewType 별 해상도 고정, 로케일·타입당 최대 3개. 어기면 인코딩 단계에서 거부된다. previewFrameTimeCode(HH:MM:SS:FF)로 포스터 프레임을 지정할 수 있다. 파일은 절대경로로 넘긴다 (대용량이라 조각 업로드하며, 동영상 바이트는 대화에 싣지 않는다).':
    'Upload a product page preview video or place an existing Asset Library video. The Asset Library method uses placementGroup plus filePath or assetId. The existing-set method uses previewType and filePath. If the Asset Library result is processing, request the placement again with the same assetId after encoding completes. Verify saved placements with appstore_list_previews. Apple constraints: length 15–30 seconds, fixed resolution per previewType, max 3 per locale and type. Violations are rejected at the encoding stage. previewFrameTimeCode (HH:MM:SS:FF) sets the poster frame. Pass the file as an absolute path (it is large, so it is uploaded in chunks, and the video bytes are not put into the conversation).',
  '기존 미리보기 타입 (기기군)':
    'Existing preview type (device family)',
  '동영상 파일 절대경로 (.mp4 / .mov / .m4v)':
    'Absolute path of the video file (.mp4 / .mov / .m4v)',
  '재사용할 Asset Library 동영상 ID':
    'Asset Library video ID to reuse',
  '포스터 프레임 시각 HH:MM:SS:FF (예: 00:00:03:00)':
    'Poster frame time HH:MM:SS:FF (e.g. 00:00:03:00)',
  '기존 미리보기 동영상 또는 세트를 삭제한다 — DELETE /v1/appPreviews/{id} 또는 /appPreviewSets/{id}. ⚠️ 되돌릴 수 없다. 세트를 지우면 그 안의 동영상이 모두 사라진다. confirm 필요.':
    'Delete an existing preview video or set — DELETE /v1/appPreviews/{id} or /appPreviewSets/{id}. ⚠️ Cannot be undone. Deleting a set removes all videos in it. Requires confirm.',
  '기존 미리보기 ID (set 과 둘 중 하나)':
    'Existing preview ID (one of this or set)',
  '기존 미리보기 세트 ID (안의 동영상 전부 삭제)':
    'Existing preview set ID (deletes all videos in it)',
  'true 명시 시에만 삭제':
    'Deletes only when explicitly true',
  '한 버전 로케일과 Asset Library 배치 그룹의 미디어 순서를 변경하고 저장된 순서를 다시 확인한다.':
    'Change the media order for one version locale and Asset Library placement group, then re-verify the saved order.',
  'Asset Library 배치 그룹':
    'Asset Library placement group',
  '같은 그룹의 모든 placementId를 표시할 순서대로 지정':
    'Every placementId in the same group, in the order to display',
  'Sales and Trends 리포트 = **실매출의 기준선** — GET /v1/salesReports (gzip TSV 를 파싱해 돌려준다). 분석 이벤트(GA4 in_app_purchase 등)로 매출을 세면 안 되는 이유가 여기 있다: TestFlight·Xcode 설치의 결제는 **sandbox 라 청구가 0원인데도** 클라이언트에는 성공한 결제로 보여 이벤트가 그대로 나간다. 이 리포트에는 sandbox 가 애초에 들어오지 않으므로, 둘을 비교하면 "진짜 돈이 들어온 건수"가 곧바로 갈린다. ⚠️ **Developer Proceeds 는 1개당 금액이다** — 총액은 units 를 곱해야 한다(이 도구는 곱해서 준다). ⚠️ 환불은 units 가 **음수**로 들어와 합계에서 상쇄된다. 즉 합계는 순매출이다. ⚠️ 데이터가 없는 날짜는 Apple 이 404 를 주므로 datesWithoutData 로 따로 돌려준다 — "매출 0" 과 "리포트 미생성/설정 오류"를 섞지 말 것. 당일치는 보통 아직 없다. vendorNumber 는 ~/.mimi-seed/appstore.json 에 저장해두면 생략 가능. ⚠️ **리포트는 요구 롤이 다르다** — Admin/Finance/Sales and Reports 중 하나여야 하고, 배포에 흔히 쓰는 App Manager 키는 여기서만 403 이 난다. 발급된 키의 롤은 수정할 수 없으므로, 읽기 전용 Finance 키를 발급해 appstore.json 의 **reportsKey** 에 넣으면 배포 키를 건드리지 않아도 된다.':
    'Sales and Trends report = **the baseline for real revenue** — GET /v1/salesReports (parses the gzip TSV and returns it). This is why you must not count revenue from analytics events (GA4 in_app_purchase, etc.): payments from TestFlight/Xcode installs are **sandbox, so nothing is charged**, yet the client sees them as successful payments and the events still fire. Sandbox never enters this report, so comparing the two immediately separates "purchases where real money came in". ⚠️ **Developer Proceeds is a per-unit amount** — the total requires multiplying by units (this tool does the multiplication for you). ⚠️ Refunds come in with **negative** units and cancel out in the sum, so the sum is net revenue. ⚠️ Apple returns 404 for dates with no data, so those are returned separately as datesWithoutData — do not conflate "zero revenue" with "report not generated / misconfiguration". Today\'s data is usually not there yet. vendorNumber can be omitted if saved in ~/.mimi-seed/appstore.json. ⚠️ **Reports require a different role** — it must be one of Admin/Finance/Sales and Reports, and an App Manager key commonly used for releases gets 403 here only. An issued key\'s role cannot be changed, so issue a read-only Finance key and put it in **reportsKey** in appstore.json to avoid touching the release key.',
  '시작일 YYYY-MM-DD (DAILY 가 아니면 이 값이 곧 reportDate)':
    'Start date YYYY-MM-DD (if not DAILY, this value is the reportDate)',
  '종료일 YYYY-MM-DD (포함). DAILY 에서만 의미가 있고 최대 62일':
    'End date YYYY-MM-DD (inclusive). Meaningful only for DAILY, max 62 days',
  '집계 단위 (기본 DAILY)':
    'Aggregation frequency (default DAILY)',
  '기본 SALES. 구독 분석은 SUBSCRIPTION / SUBSCRIPTION_EVENT / SUBSCRIBER':
    'Default SALES. For subscription analysis: SUBSCRIPTION / SUBSCRIPTION_EVENT / SUBSCRIBER',
  '기본 SUMMARY. 상세는 DETAILED':
    'Default SUMMARY. For detail: DETAILED',
  '리포트 버전 (기본 1_0). SUBSCRIPTION 계열은 1_3 등 다른 버전을 요구할 수 있다':
    'Report version (default 1_0). SUBSCRIPTION-type reports may require a different version such as 1_3',
  '판매자 번호. 생략 시 ~/.mimi-seed/appstore.json 의 vendorNumber 사용':
    'Vendor number. When omitted, uses vendorNumber from ~/.mimi-seed/appstore.json',
  '재무(정산) 리포트 — GET /v1/financeReports. 실제로 지급되는 금액 기준이라 Sales and Trends(판매 시점 집계)와 숫자가 다를 수 있다. ⚠️ **reportDate 는 Apple 회계월이다** — 달력월과 어긋난다(회계연도가 9월 말에 시작). 요청한 달과 다른 기간이 돌아오면 버그가 아니라 이것이다. 매출 건수를 세는 목적이면 appstore_get_sales_report(달력 날짜 기준)를 쓰는 편이 낫다. regionCode 는 ZZ(전 지역 통합)가 기본이고, FINANCE_DETAIL 은 보통 Z1 을 쓴다. 컬럼 구성이 리포트마다 달라 파싱한 행을 그대로 돌려준다.':
    'Finance (settlement) report — GET /v1/financeReports. Based on amounts actually paid out, so numbers can differ from Sales and Trends (aggregated at time of sale). ⚠️ **reportDate is an Apple fiscal month** — it does not align with calendar months (the fiscal year starts at the end of September). If a period different from the requested month comes back, this is why, not a bug. To count purchases, appstore_get_sales_report (calendar-date based) is the better choice. regionCode defaults to ZZ (all regions combined); FINANCE_DETAIL usually uses Z1. Column layout differs per report, so parsed rows are returned as is.',
  'YYYY-MM (Apple 회계월)':
    'YYYY-MM (Apple fiscal month)',
  '지역 코드 (기본 ZZ = 전 지역 통합)':
    'Region code (default ZZ = all regions combined)',
  '기본 FINANCIAL':
    'Default FINANCIAL',
} satisfies Record<string, string>;
