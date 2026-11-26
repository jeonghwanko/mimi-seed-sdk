/** playstore 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  'Google Play 앱 세부정보 조회 — 개발자 연락처(이메일·전화·웹사이트)·기본 언어 등 (edits.details). 수정은 playstore_update_details.':
    'Get Google Play app details — developer contact (email, phone, website), default language, etc. (edits.details). To modify, use playstore_update_details.',
  '패키지명 (예: com.example.app)':
    'Package name (e.g. com.example.app)',
  'Google Play 앱 세부정보(개발자 연락처·기본 언어) 수정 — 연락처 이메일/전화/웹사이트, 기본 언어. 스토어 리스팅(제목·설명)과는 별개이며, 넘긴 필드만 부분 갱신(edits.details.patch). ⚠️ Console 에서 같은 앱을 편집·미게시 중이면 충돌할 수 있음.':
    'Update Google Play app details (developer contact, default language) — contact email/phone/website and default language. Separate from the store listing (title, description); only the fields you pass are partially updated (edits.details.patch). ⚠️ May conflict if the same app is being edited/unpublished in the Console.',
  '개발자 연락처 이메일 (스토어 등록정보에 공개)':
    'Developer contact email (public on the store listing)',
  '개발자 연락처 전화번호 (선택)':
    'Developer contact phone number (optional)',
  '개발자 웹사이트 URL (예: https://example.com)':
    'Developer website URL (e.g. https://example.com)',
  '기본 언어 코드 (예: ko-KR, en-US)':
    'Default language code (e.g. ko-KR, en-US)',
  'Google Play 스토어 리스팅 조회 (제목, 설명문 등)':
    'Get the Google Play store listing (title, description, etc.)',
  '패키지명':
    'Package name',
  '언어 코드 (기본: ko-KR)':
    'Language code (default: ko-KR)',
  'Google Play 스토어 리스팅 수정 또는 새 언어 생성. 기존 언어는 넘긴 필드만 부분 갱신(edits.listings.patch)해 생략한 필드와 프로모 영상(video)을 보존한다. 새 언어는 title·shortDescription·fullDescription을 모두 전달해야 하며 전체 리스팅을 생성한다. ⚠️ Play API 편집과 Console 동시 편집은 충돌 — Console에서 같은 리스팅을 편집·미게시 중이면 그 변경이 덮어써질 수 있음.':
    'Update a Google Play store listing or create a new language. For an existing language, only the fields you pass are partially updated (edits.listings.patch), preserving omitted fields and the promo video (video). For a new language, you must pass all of title, shortDescription, and fullDescription; it creates the full listing. ⚠️ Play API edits conflict with concurrent Console edits — if the same listing is being edited/unpublished in the Console, those changes may be overwritten.',
  '언어 코드 (예: ko-KR, en-US)':
    'Language code (e.g. ko-KR, en-US)',
  '앱 제목 (30자 이내)':
    'App title (up to 30 characters)',
  '짧은 설명 (80자 이내)':
    'Short description (up to 80 characters)',
  '전체 설명 (4000자 이내)':
    'Full description (up to 4000 characters)',
  'Google Play 릴리스 트랙 현황 (프로덕션/베타/알파/내부)':
    'Google Play release track status (production/beta/alpha/internal)',
  'Google Play Developer Reporting API / Android vitals 통계 조회. ANR/Crash/Error count를 기간·버전·기기·국가 등으로 분해해 확인':
    'Get Google Play Developer Reporting API / Android vitals statistics. Breaks down ANR/Crash/Error count by period, version, device, country, etc.',
  '조회할 Vitals metric set. 기본: anrRate':
    'Vitals metric set to query. Default: anrRate',
  '시작일 YYYY-MM-DD (포함)':
    'Start date YYYY-MM-DD (inclusive)',
  '종료일 YYYY-MM-DD (보통 exclusive처럼 다음날 지정 권장)':
    'End date YYYY-MM-DD (setting it to the next day, as if exclusive, is usually recommended)',
  '집계 단위':
    'Aggregation period',
  '분해 차원. 기본: ["versionCode"] (errorCount는 ["reportType","versionCode"]). reportType/issueId는 errorCount 전용, countryCode/deviceBrand는 anrRate/crashRate 전용':
    'Breakdown dimensions. Default: ["versionCode"] (["reportType","versionCode"] for errorCount). reportType/issueId are errorCount-only; countryCode/deviceBrand are anrRate/crashRate-only',
  '조회 metric. 기본은 metricSet별 핵심 metric + distinctUsers':
    'Metrics to query. Default: the core metric for each metricSet + distinctUsers',
  'AIP-160 필터. 예: versionCode = 42':
    'AIP-160 filter. e.g. versionCode = 42',
  '최대 행 수':
    'Maximum number of rows',
  '다음 페이지 토큰':
    'Next page token',
  '사용자 cohort':
    'User cohort',
  '날짜 기준 timezone. 기본: America/Los_Angeles (Play Reporting API 샘플/지원 기준)':
    'Timezone for dates. Default: America/Los_Angeles (per the Play Reporting API samples/support)',
  'Google Play 리스팅 이미지 목록 조회 (imageType별)':
    'List Google Play listing images (by imageType)',
  '언어 코드 (예: ko-KR)':
    'Language code (e.g. ko-KR)',
  '이미지 타입':
    'Image type',
  'Google Play 리스팅 이미지 단일 업로드 (기존 이미지 유지). featureGraphic 1024x500 / icon 512x512 / phoneScreenshots 320~3840px. ⚠️ 이 작업은 edit을 commit하므로 Play Console의 미게시(저장 전) 리스팅 변경을 덮어쓸 수 있음 — Console에서 같은 앱을 편집 중이면 먼저 저장·게시하거나 텍스트도 update_listing으로 처리하세요.':
    'Upload a single Google Play listing image (existing images are kept). featureGraphic 1024x500 / icon 512x512 / phoneScreenshots 320–3840px. ⚠️ This operation commits the edit, so it may overwrite unpublished (unsaved) listing changes in Play Console — if the same app is being edited in the Console, save/publish there first or handle the text through update_listing as well.',
  '언어 코드':
    'Language code',
  '업로드할 이미지 절대 경로':
    'Absolute path of the image to upload',
  'Google Play 리스팅 특정 imageType의 이미지 전체 삭제 (교체 전 정리). ⚠️ commit이 Play Console의 미게시 리스팅 변경을 덮어쓸 수 있음.':
    'Delete all images of a specific imageType from a Google Play listing (cleanup before replacing). ⚠️ The commit may overwrite unpublished listing changes in Play Console.',
  'Google Play 리스팅 이미지 일괄 교체 (한 edit 세션: deleteall → 순서대로 upload → commit). 스크린샷 5~8장 한 번에 교체 시 효율적. 업로드 순서가 스토어 노출 순서. ⚠️ commit이 Play Console의 미게시 리스팅 변경을 덮어쓸 수 있음.':
    'Replace Google Play listing images in bulk (one edit session: deleteall → upload in order → commit). Efficient for replacing 5–8 screenshots at once. Upload order is the store display order. ⚠️ The commit may overwrite unpublished listing changes in Play Console.',
  '업로드할 이미지 절대 경로 배열 (순서 = 노출 순서)':
    'Array of absolute paths of images to upload (order = display order)',
  'Google Play 트랙 릴리스의 \'최근 변경사항\'(releaseNotes) 업데이트. 다른 언어/release는 보존. 이미 라이브(completed) 상태도 noteOnly 편집 가능. versionCode 를 주면 그 릴리스, 생략하면 트랙의 최신 릴리스(versionCode 최대)에 적용한다. ⚠️ 지정한 트랙에만 적용 — 다른 트랙에는 자동 복사되지 않음 (Google Play 정책: promote_release 시점에 노트 캐리됨). 동일 노트를 여러 트랙에 즉시 반영하려면 syncTracks 사용 — 1차 track 반영 후 트랙별 최신 릴리스에 순차 적용. syncTracks 는 versionCode 생략 시에만 쓸 수 있다 (트랙마다 같은 versionCode 가 있다는 보장이 없어 함께 주면 거부).':
    'Update the "What\'s new" (releaseNotes) of a Google Play track release. Other languages/releases are preserved. Releases already live (completed) can also have just their notes edited. If versionCode is given, applies to that release; when omitted, to the track\'s latest release (highest versionCode). ⚠️ Applies only to the specified track — not automatically copied to other tracks (Google Play policy: notes are carried over at promote_release time). To apply the same notes to several tracks immediately, use syncTracks — after the primary track is updated, applies sequentially to each track\'s latest release. syncTracks can be used only when versionCode is omitted (rejected if both are given, since there is no guarantee each track has the same versionCode).',
  '릴리스 트랙 (1차 적용 트랙)':
    'Release track (primary track to apply to)',
  '대상 versionCode (문자열, 예: "40"). 생략 시 트랙의 최신 릴리스':
    'Target versionCode (string, e.g. "40"). When omitted, the track\'s latest release',
  '릴리스 노트 본문 (500자 이내)':
    'Release notes text (up to 500 characters)',
  '추가로 동일 노트 적용할 트랙 배열 (예: ["production"]). versionCode 생략 시에만. 1차 track 반영 후 순차 동기화.':
    'Array of additional tracks to apply the same notes to (e.g. ["production"]). Only when versionCode is omitted. Synced sequentially after the primary track is updated.',
  'Google Play 리뷰를 조회합니다. 옵션을 주면 한 페이지의 reviews와 nextPageToken을 반환합니다. 미답변만 조회하면 결과가 비어도 다음 페이지가 있을 수 있습니다. 패키지명만 주면 기존 전체 조회를 사용합니다.':
    'List Google Play reviews. When options are given, returns one page of reviews and nextPageToken. When querying unanswered only, there may be a next page even if the results are empty. If only the package name is given, uses the existing full listing.',
  '미답변 리뷰만 반환':
    'Return only unanswered reviews',
  '필터링 전 페이지 크기 (기본 20)':
    'Page size before filtering (default 20)',
  '이전 응답의 nextPageToken':
    'nextPageToken from the previous response',
  'Google Play 리뷰에 답변':
    'Reply to a Google Play review',
  '리뷰 ID':
    'Review ID',
  '답변 내용':
    'Reply text',
  'Google Play 인앱 상품 목록':
    'List Google Play in-app products',
  'Google Play 구독 상품 목록':
    'List Google Play subscription products',
  'Google Play에 일회성 인앱 상품(소비성 또는 비소비성)을 생성. Play Console 권한: "Manage store presence" 필요. 생성 후 Console에서 활성화 필요.':
    'Create a one-time in-app product (consumable or non-consumable) on Google Play. Requires the Play Console permission "Manage store presence". Must be activated in the Console after creation.',
  '상품 ID (소문자/숫자/언더스코어/점, 예: premium_unlock). 한 번 정하면 변경 불가.':
    'Product ID (lowercase/digits/underscore/dot, e.g. premium_unlock). Cannot be changed once set.',
  '상품 이름 (스토어 노출 제목)':
    'Product name (title shown in the store)',
  '주 통화 기준 가격 (최소 단위: USD/EUR이면 cents, KRW/JPY이면 원화 정수. 예: USD $4.99 → 499, KRW ₩5,900 → 5900)':
    'Price in the primary currency (smallest unit: cents for USD/EUR, integer won/yen for KRW/JPY. e.g. USD $4.99 → 499, KRW ₩5,900 → 5900)',
  'ISO 4217 통화 코드 (기본 USD)':
    'ISO 4217 currency code (default USD)',
  '상품 유형 (소비성/비소비성). 앱이 consumePurchase 호출하면 소비성.':
    'Product type (consumable/non-consumable). Consumable if the app calls consumePurchase.',
  '추가 지역별 명시 가격. 자동 환산이 부정확한 KRW/JPY 등에 직접 지정.':
    'Additional explicit per-region prices. Set directly for KRW/JPY etc. where automatic conversion is inaccurate.',
  'ISO 4217 통화 코드 (예: KRW, JPY, GBP)':
    'ISO 4217 currency code (e.g. KRW, JPY, GBP)',
  '가격 (최소 단위: KRW ₩1,100 → 1100, USD $0.99 → 99)':
    'Price (smallest unit: KRW ₩1,100 → 1100, USD $0.99 → 99)',
  'Google Play에 자동 갱신 구독을 생성하고 baseplan을 활성화. 구독 생성 → baseplan(가격·주기) 추가 → 자동 활성화. 이미 같은 productId가 있으면 생성 실패 (Play API 특성상 upsert 미지원).':
    'Create an auto-renewing subscription on Google Play and activate the baseplan. Create subscription → add baseplan (price, period) → auto-activate. Creation fails if the same productId already exists (the Play API does not support upsert).',
  '구독 상품 ID (소문자/숫자/언더스코어/점, 예: premium_monthly)':
    'Subscription product ID (lowercase/digits/underscore/dot, e.g. premium_monthly)',
  '구독 제목 (스토어 노출)':
    'Subscription title (shown in the store)',
  '주 통화 기준 가격 (최소 단위: USD cents. 예: $4.99 → 499, ₩5,900 → 5900)':
    'Price in the primary currency (smallest unit: USD cents. e.g. $4.99 → 499, ₩5,900 → 5900)',
  '청구 주기':
    'Billing period',
  '추가 지역별 명시 가격':
    'Additional explicit per-region prices',
  'ISO 4217 통화 코드 (예: KRW, JPY)':
    'ISO 4217 currency code (e.g. KRW, JPY)',
  '가격 (최소 단위)':
    'Price (smallest unit)',
  '서비스 계정 JSON이 주어진 packageName에 대해 Play Developer API 호출 가능한지 + \'View financial data\' 권한까지 있는지 검증. onesub 같은 서버가 Play 영수증을 백그라운드로 검증하려면 OAuth 토큰 대신 서비스 계정 JSON이 필요 — 이 도구로 붙여넣기 전에 유효성 확인. 성공 시 clientEmail + projectId 반환. 실패 시 어느 단계(parse/auth/api)에서 왜 막혔는지 단계별로 안내. (이 도구는 서비스 계정 자격증명만 사용 — 로그인한 사용자의 OAuth 토큰은 건드리지 않음)':
    'Verify that a service account JSON can call the Play Developer API for the given packageName + also has the \'View financial data\' permission. A server like onesub that verifies Play receipts in the background needs a service account JSON instead of an OAuth token — use this tool to validate it before pasting. On success returns clientEmail + projectId. On failure, explains step by step at which stage (parse/auth/api) and why it was blocked. (This tool uses only the service account credentials — it does not touch the signed-in user\'s OAuth token)',
  '권장 — iam_create_key 가 저장한 키 파일 절대경로 (~/.mimi-seed/keys/ 안만 허용). 개인키가 대화에 남지 않음':
    'Recommended — absolute path of a key file saved by iam_create_key (only inside ~/.mimi-seed/keys/ is allowed). The private key does not remain in the conversation',
  '서비스 계정 JSON 전체 내용 (문자열). serviceAccountJsonPath 와 둘 중 하나. 문자열로 넘기면 개인키가 대화 기록에 남는다':
    'Full contents of the service account JSON (string). Either this or serviceAccountJsonPath. Passing it as a string leaves the private key in the conversation history',
  '검증할 Android 앱의 패키지명 (예: com.example.app)':
    'Package name of the Android app to verify (e.g. com.example.app)',
  'Google Play 서비스 계정 JSON을 패키지 단위로 등록 (~/.mimi-seed/play-service-accounts/{packageName}.json, 0600 mode). 여러 앱이 서로 다른 GCP 프로젝트의 SA를 쓰는 환경 지원. 등록 후 해당 packageName으로 호출하는 모든 playstore_* 도구가 이 SA를 사용 (등록 안 된 패키지는 ~/.mimi-seed/play-service-account.json 의 default SA로 폴백). 먼저 playstore_verify_service_account 로 권한 확인 후 등록을 권장.':
    'Register a Google Play service account JSON per package (~/.mimi-seed/play-service-accounts/{packageName}.json, 0600 mode). Supports setups where multiple apps use SAs from different GCP projects. After registration, every playstore_* tool called with that packageName uses this SA (unregistered packages fall back to the default SA in ~/.mimi-seed/play-service-account.json). Recommended: check permissions with playstore_verify_service_account first, then register.',
  'Android 패키지명 (예: com.example.app)':
    'Android package name (e.g. com.example.app)',
  '서비스 계정 JSON 전체 내용 (문자열). serviceAccountJsonPath 와 둘 중 하나':
    'Full contents of the service account JSON (string). Either this or serviceAccountJsonPath',
  'true면 사전 검증 건너뜀 (기본 false: 등록 전 verifyServiceAccountJson 실행)':
    'If true, skips pre-validation (default false: runs verifyServiceAccountJson before registering)',
  '등록된 패키지별 서비스 계정 + default(레거시) SA 정보 요약. clientEmail / projectId 만 노출 (private_key 미노출).':
    'Summary of registered per-package service accounts + the default (legacy) SA. Exposes only clientEmail / projectId (private_key is not exposed).',
  '등록된 패키지별 서비스 계정 삭제. default(레거시) SA는 영향 없음.':
    'Delete a registered per-package service account. The default (legacy) SA is not affected.',
  '삭제할 패키지명':
    'Package name to delete',
  'Google Play 배포 플랜 — 인증/빌드/메타데이터/스크린샷/정책 위험을 한 번에 점검하고 체크리스트로 반환합니다 (read-only, 아무것도 변경하지 않음). ⚠️ AI 호출자 지시: 응답을 받으면 미완료 항목을 반드시 TodoWrite로 사용자에게 먼저 보여주고, 사용자 동의 후 단계별로 기존 도구(playstore_update_listing, playstore_update_release_notes, playstore_submit_release 등)를 호출하세요. submit_release(status=completed)는 비가역이므로 반드시 명시 동의 필요.':
    'Google Play release plan — checks auth/build/metadata/screenshot/policy risks at once and returns a checklist (read-only, changes nothing). ⚠️ Instruction for the AI caller: on receiving the response, you must first show the incomplete items to the user with TodoWrite, and after the user agrees, call the existing tools step by step (playstore_update_listing, playstore_update_release_notes, playstore_submit_release, etc.). submit_release(status=completed) is irreversible and must have the user\'s explicit approval.',
  '확인할 versionCode. 미지정 시 트랙 최신 release 검사':
    'versionCode to check. When omitted, checks the track\'s latest release',
  '대상 트랙 (기본: production)':
    'Target track (default: production)',
  '점검할 리스팅 언어 (기본: ko-KR)':
    'Listing language to check (default: ko-KR)',
  'Google Play 트랙의 release status를 변경 — 일반적으로 draft → completed로 바꿔 검토/배포 큐에 진입시킬 때 사용. completed 전환은 해당 트랙의 릴리스 목록을 대상 릴리스 하나로 교체한다. changesNotSentForReview=true 응답이면 커밋만 완료된 것이며 Console에서 심사 전송이 필요하다. ⚠️ status="completed"는 비가역에 가까움 (전체 출시 또는 Google 검토 시작). halted로 일시 중단은 가능하나 한 번 라이브된 release는 되돌리기 어려움. status 옵션: draft(검토 미시작) / inProgress(단계 출시) / completed(전체 출시) / halted(중단). playstore_check_submission_risks로 사전 점검 권장.':
    'Change the release status of a Google Play track — typically used to change draft → completed so it enters the review/rollout queue. Switching to completed replaces the track\'s release list with the single target release. If the response has changesNotSentForReview=true, only the commit is done and the release must be sent for review in the Console. ⚠️ status="completed" is close to irreversible (full rollout or start of Google review). Pausing with halted is possible, but a release that has gone live is hard to revert. status options: draft (review not started) / inProgress (staged rollout) / completed (full rollout) / halted (stopped). Recommended: pre-check with playstore_check_submission_risks.',
  '릴리스 트랙':
    'Release track',
  '대상 versionCode (문자열)':
    'Target versionCode (string)',
  '새 status (기본: completed)':
    'New status (default: completed)',
  'Google Play 트랙 간 release promote — fromTrack(예: internal)의 versionCode를 toTrack(예: production)에 새 release로 추가. 단일 edit session에서 source 조회 → target 업데이트 → commit 까지 한 번에 처리. source의 releaseNotes를 자동 복사 (copyReleaseNotes=false 또는 releaseNotes로 덮어쓰기 가능). status="completed" + production 으로 전체 출시, status="inProgress" + userFraction 으로 단계 출시(예: 0.1 = 10%). target에 같은 versionCode가 이미 있으면 해당 항목을 교체. status="completed"면 target 활성 release를 통째로 새 것으로 대체. ⚠️ status="completed"는 비가역에 가까움. playstore_check_submission_risks로 사전 점검 권장. Play 가 자동 심사 전송을 거부하는 앱이면 changesNotSentForReview=true 로 자동 폴백해 커밋한다 — 이때 응답의 changesNotSentForReview=true 와 nextAction 을 사용자에게 전달할 것(콘솔에서 "심사를 위해 전송"을 눌러야 심사 시작). source 트랙 노트가 버전 문자열뿐인 플레이스홀더면 warnings 로 알린다 — 그대로 승격하면 대상 트랙의 다국어 노트가 덮인다.':
    'Promote a release between Google Play tracks — adds the versionCode from fromTrack (e.g. internal) as a new release on toTrack (e.g. production). Handles reading the source → updating the target → commit in a single edit session. Automatically copies the source releaseNotes (can be overridden with copyReleaseNotes=false or releaseNotes). status="completed" + production for a full rollout; status="inProgress" + userFraction for a staged rollout (e.g. 0.1 = 10%). If the target already has the same versionCode, that entry is replaced. With status="completed", the target\'s active release is replaced wholesale with the new one. ⚠️ status="completed" is close to irreversible. Recommended: pre-check with playstore_check_submission_risks. If Play refuses automatic sending for review for the app, it automatically falls back to changesNotSentForReview=true and commits — in that case pass the response\'s changesNotSentForReview=true and nextAction on to the user (review starts only after clicking "Send for review" in the Console). If the source track\'s notes are a placeholder containing only the version string, it reports this in warnings — promoting as-is overwrites the target track\'s multilingual notes.',
  '출처 트랙 (예: internal)':
    'Source track (e.g. internal)',
  '대상 트랙 (예: production)':
    'Target track (e.g. production)',
  'promote할 versionCode (문자열)':
    'versionCode to promote (string)',
  '대상 트랙에서의 status (기본 completed)':
    'Status on the target track (default completed)',
  'status="inProgress"일 때 단계 출시 비율 (0~1, 예: 0.1)':
    'Staged rollout fraction when status="inProgress" (0–1, e.g. 0.1)',
  'release 이름 (미지정 시 source 이름 그대로)':
    'Release name (when omitted, the source name as-is)',
  'source releaseNotes 복사 여부 (기본 true)':
    'Whether to copy the source releaseNotes (default true)',
  '대상 트랙용 릴리스 노트 (미지정 + copyReleaseNotes=true면 source 그대로)':
    'Release notes for the target track (when omitted + copyReleaseNotes=true, the source notes as-is)',
  'Google Play의 모든 IAP 상품(구독 + 일회성) 통합 조회. productId / name / status / type / price / currency 반환.':
    'List all Google Play IAP products (subscriptions + one-time) together. Returns productId / name / status / type / price / currency.',
  'Google Play 인앱 상품(소모성/비소모성)의 언어별 제목·설명을 갱신. 넘긴 로케일만 덮어쓰고 나머지 언어는 보존한다. 리스팅이 없는 언어의 사용자에게는 앱 기본 언어 리스팅이 대신 보인다 — 번역을 넣어야 그 나라 결제창이 그 나라 말로 나온다. 구독은 playstore_update_subscription_listing 을 쓴다.':
    'Update per-language title/description of a Google Play in-app product (consumable/non-consumable). Overwrites only the locales you pass and preserves the other languages. Users in a language without a listing see the app\'s default-language listing instead — a translation is needed for the purchase dialog to appear in that country\'s language. For subscriptions, use playstore_update_subscription_listing.',
  '상품 ID (playstore_list_inapp_products 결과)':
    'Product ID (from playstore_list_inapp_products results)',
  '갱신할 언어별 리스팅':
    'Per-language listings to update',
  '언어 코드 (예: ko-KR, en-US, ja-JP, zh-TW)':
    'Language code (e.g. ko-KR, en-US, ja-JP, zh-TW)',
  '제목 (55자 이하). 새 언어 추가 시 필수':
    'Title (55 characters or fewer). Required when adding a new language',
  '설명 (200자 이하)':
    'Description (200 characters or fewer)',
  'Google Play 구독 상품의 언어별 제목·설명·혜택(benefits)을 갱신. 넘긴 로케일만 덮어쓰고 나머지 언어는 보존한다. benefits 는 스토어 구매창에 불릿으로 나오는 항목이라 한 줄에 몰아넣지 말고 항목을 나눠 넣는다 (최대 4개).':
    'Update per-language title/description/benefits of a Google Play subscription product. Overwrites only the locales you pass and preserves the other languages. benefits are shown as bullets in the store purchase dialog, so split them into separate items instead of packing them into one line (max 4).',
  '구독 상품 ID (playstore_list_subscriptions 결과)':
    'Subscription product ID (from playstore_list_subscriptions results)',
  '혜택 항목 (각 40자 이하, 최대 4개). 생략하면 기존 값 유지':
    'Benefit items (each 40 characters or fewer, max 4). When omitted, the existing values are kept',
  'Google Play 인앱 상품의 구매 옵션을 활성화/비활성화 — Play Console 의 DRAFT → 활성 토글. DRAFT 인 상품은 가격이 앱에 안 내려오므로 만들고 활성화하지 않으면 상점 화면이 비어 보인다. purchaseOptionId 는 playstore_list_inapp_products 의 purchaseOptions[].purchaseOptionId (보통 "base").':
    'Activate/deactivate a purchase option of a Google Play in-app product — the DRAFT → active toggle in Play Console. Prices of DRAFT products are not delivered to the app, so if you create a product without activating it the store screen looks empty. purchaseOptionId is purchaseOptions[].purchaseOptionId from playstore_list_inapp_products (usually "base").',
  '상품 ID':
    'Product ID',
  '구매 옵션 ID (기본 "base")':
    'Purchase option ID (default "base")',
  '활성화 / 비활성화':
    'Activate / deactivate',
  'Google Play IAP 상품의 표시 이름 변경 (현재 name 필드만 수정 가능). productId / type / 가격은 변경 불가. 언어별 제목·설명은 playstore_update_product_listing / playstore_update_subscription_listing 을 쓴다.':
    'Change the display name of a Google Play IAP product (currently only the name field can be modified). productId / type / price cannot be changed. For per-language title/description, use playstore_update_product_listing / playstore_update_subscription_listing.',
  '상품 유형':
    'Product type',
  '새 표시 이름':
    'New display name',
  '⚠️ 비가역. Google Play IAP 상품 삭제. 활성 baseplan + 구독자 있는 구독은 삭제 불가.':
    '⚠️ Irreversible. Delete a Google Play IAP product. A subscription with an active baseplan + subscribers cannot be deleted.',
  'Play Store 서비스 계정을 한 번에 설정합니다 (SA 생성 → JSON 키 발급 → 로컬 등록). iam_create_service_account → iam_create_key → playstore_register_service_account 를 순서대로 자동 실행. 완료 후 Play Console에서 서비스 계정 이메일을 초대하는 안내(수동 1단계)가 포함됩니다. 이미 같은 accountId의 SA가 존재하면 키만 새로 발급하고 등록합니다.':
    'Set up a Play Store service account in one go (create SA → issue JSON key → register locally). Automatically runs iam_create_service_account → iam_create_key → playstore_register_service_account in order. On completion, includes instructions for inviting the service account email in Play Console (1 manual step). If an SA with the same accountId already exists, only issues a new key and registers it.',
  'Google Cloud 프로젝트 ID (예: my-project-123). Firebase 콘솔 → 프로젝트 설정에서 확인.':
    'Google Cloud project ID (e.g. my-project-123). Find it in Firebase console → Project settings.',
  '서비스 계정 ID (기본: mimi-play-publisher)':
    'Service account ID (default: mimi-play-publisher)',
  'Play 데이터 안전(Safety Labels) 선언을 업로드한다 — POST applications/{packageName}/dataSafety. 오래 Console 전용으로 알려졌던 항목이지만 API 가 있다. 입력은 Play Console 이 내려주는 **CSV 원문**이다 (Console > 앱 콘텐츠 > 데이터 안전 > 내보내기). ⚠️ 기존 제출을 통째로 덮어쓴다 — 부분 갱신이 아니므로 항상 최신 전체 CSV 를 보낼 것. 콘텐츠 등급·타깃 연령 설문은 여전히 API 가 없다 (Console 전용).':
    'Upload the Play Data safety (Safety Labels) declaration — POST applications/{packageName}/dataSafety. Long believed to be Console-only, but an API exists. The input is the **raw CSV** exported by Play Console (Console > App content > Data safety > Export). ⚠️ Overwrites the existing submission entirely — not a partial update, so always send the latest full CSV. The content rating and target age questionnaires still have no API (Console-only).',
  '데이터 안전 CSV 파일의 절대경로. csv 와 둘 중 하나는 필수':
    'Absolute path of the Data safety CSV file. Either this or csv is required',
  'CSV 원문 문자열. csvPath 와 둘 중 하나는 필수':
    'Raw CSV string. Either this or csvPath is required',
  'true 명시 시에만 업로드. 생략/false 면 요약만 반환.':
    'Uploads only when explicitly true. When omitted/false, returns a summary only.',
  '앱 복구 액션 목록을 조회한다 — 읽기 전용 (apprecovery.list). 이미 배포된 앱이 치명적으로 망가졌을 때 특정 버전 사용자에게 원격 인앱 업데이트를 밀어 넣는 장치다. 상태(DRAFT/ACTIVE/CANCELED)·생성·배포·취소 시각과 대상을 보여준다.':
    'List app recovery actions — read-only (apprecovery.list). A mechanism for pushing a remote in-app update to users of specific versions when an already-released app is critically broken. Shows status (DRAFT/ACTIVE/CANCELED), creation/deploy/cancel times, and targets.',
  '특정 버전 코드로 필터':
    'Filter by a specific version code',
  '앱 복구 액션을 DRAFT 상태로 만든다 — apprecovery.create. 만들기만 하고 배포하지 않는다 (배포는 playstore_deploy_recovery_action). 대상은 allUsers 또는 versionCodes / versionRange 중 하나로 정한다 — allUsers 와 버전 지정은 함께 못 쓴다. ⚠️ 배포 후에는 대상을 만들 때 고른 기준 안에서만 넓힐 수 있다. 범위를 신중히 잡을 것. 이건 롤백이 아니라 "고친 버전으로 강제 업데이트"다 — 먼저 정상 빌드를 올려 둬야 의미가 있다.':
    'Create an app recovery action in DRAFT state — apprecovery.create. Only creates it, does not deploy (deploy with playstore_deploy_recovery_action). Choose the target as allUsers or one of versionCodes / versionRange — allUsers and version targeting cannot be used together. ⚠️ After deployment, the target can only be widened within the criteria chosen at creation. Scope it carefully. This is not a rollback but a "forced update to a fixed version" — it only makes sense if a working build has been uploaded first.',
  '전체 사용자 대상 (버전 지정과 함께 쓸 수 없음)':
    'Target all users (cannot be combined with version targeting)',
  '대상 버전 코드 목록':
    'List of target version codes',
  '대상 버전 범위 시작':
    'Start of the target version range',
  '대상 버전 범위 끝':
    'End of the target version range',
  '지역 코드 (예: KR, US)':
    'Region codes (e.g. KR, US)',
  'Android SDK 레벨':
    'Android SDK levels',
  'true 명시 시에만 생성. 생략/false 면 계획만 반환.':
    'Creates only when explicitly true. When omitted/false, returns the plan only.',
  'DRAFT 복구 액션을 실제로 배포한다 — apprecovery.deploy. ⚠️ 대상 사용자 기기에 원격 인앱 업데이트가 나간다. 되돌리려면 취소해야 하고, 이미 적용된 기기는 되돌아가지 않는다. 배포 전 playstore_list_recovery_actions 로 대상 범위를 반드시 재확인할 것. confirm 필요.':
    'Actually deploy a DRAFT recovery action — apprecovery.deploy. ⚠️ Sends a remote in-app update to target users\' devices. To undo it you must cancel, and devices that already applied it are not reverted. Before deploying, you must re-check the target scope with playstore_list_recovery_actions. Requires confirm.',
  '복구 액션 ID':
    'Recovery action ID',
  'true 명시 시에만 배포':
    'Deploys only when explicitly true',
  '진행 중인 복구 액션을 취소한다 — apprecovery.cancel. 아직 받지 않은 기기에는 더 이상 나가지 않는다. 이미 적용된 기기는 되돌아가지 않는다. confirm 필요.':
    'Cancel an in-progress recovery action — apprecovery.cancel. It is no longer sent to devices that have not received it yet. Devices that already applied it are not reverted. Requires confirm.',
  'true 명시 시에만 취소':
    'Cancels only when explicitly true',
  'Play 재무 리포트 파일 목록 (Cloud Storage 버킷). ⚠️ **Play Developer API 에는 매출 엔드포인트가 없다.** purchases.* 는 구매 토큰을 이미 알아야 하고 Reporting API 는 vitals 뿐이다. 실제 정산 데이터는 Play Console 이 매달 개발자 소유 GCS 버킷에 떨궈주는 CSV 가 유일한 소스라, 이 도구는 그 버킷을 훑는다. 버킷 이름(gs://pubsite_prod_...)은 Play Console > 다운로드 보고서 > 재무 에만 있고 API 로 못 얻는다 — ~/.mimi-seed/play-financials.json 에 한 번 저장해두면 이후 생략 가능. ⚠️ 접근 권한은 **GCP IAM 이 아니다.** 이 버킷은 Google 소유라 프로젝트에 roles/storage.* 를 줘도 닿지 않는다 — Play Console > 사용자 및 권한 에서 서비스 계정 이메일을 초대하고 "재무 데이터 보기"를 전체(Global)로 줘야 열린다. 앱 게시용 Play Developer API 권한과 별개라, 릴리스가 되는 계정이라고 리포트가 열려 있지는 않다. 재무 리포트는 월 마감 후에 올라오므로 이번 달 파일이 없는 것은 정상이다.':
    'List Play financial report files (Cloud Storage bucket). ⚠️ **The Play Developer API has no revenue endpoint.** purchases.* requires already knowing the purchase token, and the Reporting API is vitals only. The only source of actual settlement data is the CSVs that Play Console drops into a developer-owned GCS bucket each month, so this tool scans that bucket. The bucket name (gs://pubsite_prod_...) is only shown in Play Console > Download reports > Financial and cannot be obtained via API — save it once in ~/.mimi-seed/play-financials.json and it can be omitted afterwards. ⚠️ Access is **not GCP IAM.** The bucket is Google-owned, so granting roles/storage.* on the project does not reach it — it opens only after inviting the service account email in Play Console > Users and permissions and granting "View financial data" globally (Global). This is separate from the Play Developer API permission for publishing apps, so an account that can release does not necessarily have the reports open. Financial reports are posted after the month closes, so it is normal for the current month\'s file to be missing.',
  '패키지명 — 패키지별 서비스 계정·버킷 설정을 고를 때 사용':
    'Package name — used to pick the per-package service account and bucket settings',
  '버킷 이름 또는 gs:// URI. 생략 시 저장된 설정 사용':
    'Bucket name or gs:// URI. When omitted, uses the saved settings',
  '생략하면 버킷 전체. earnings=정산(수수료·세금 포함), sales=주문 단위':
    'When omitted, the whole bucket. earnings=settlement (incl. fees and taxes), sales=per order',
  'Play 재무 리포트를 내려받아 파싱·집계한다 = **Play 실매출의 기준선**. 분석 이벤트로는 라이선스 테스터·내부 테스트 결제를 실결제와 구분할 수 없다 (둘 다 install_source 가 com.android.vending 이다). 청구가 0원인 테스터 주문은 이 리포트에 **아예 나타나지 않으므로**, 여기 없으면 실매출이 아니다. earnings: Transaction Type 이 Charge/Google fee/Tax/환불로 나뉘고 수수료·세금이 음수로 들어와 netByMerchantCurrency 는 이미 순액이다. **Charge 행만이 실제 구매다.** sales: 주문 번호 단위라 개별 주문을 짚을 때 쓴다. ⚠️ 정산 통화마다 파일이 따로 떨어지므로 한 달치가 여러 파일일 수 있다 — 전부 합쳐서 집계한다.':
    'Download, parse, and aggregate a Play financial report = **the baseline for actual Play revenue**. Analytics events cannot distinguish license-tester/internal-testing payments from real payments (both have install_source com.android.vending). Tester orders charged 0 **do not appear in this report at all**, so if it is not here, it is not real revenue. earnings: Transaction Type is split into Charge/Google fee/Tax/refund, and fees and taxes come in as negative values, so netByMerchantCurrency is already net. **Only Charge rows are actual purchases.** sales: per order number, used to pinpoint individual orders. ⚠️ A separate file is dropped per settlement currency, so one month may span several files — aggregate them all together.',
  'YYYYMM 또는 YYYY-MM':
    'YYYYMM or YYYY-MM',
  '기본 earnings(정산). 주문 단위로 보려면 sales':
    'Default earnings (settlement). Use sales to view per order',
  '원본 행까지 전부 반환. 건수가 많으면 응답이 매우 커진다':
    'Return all raw rows too. With many records the response becomes very large',
} satisfies Record<string, string>;
