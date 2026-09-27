// scripts/gen-docs.mjs 의 **표현(presentation) 스펙** — 문서에 무엇을 어떻게 보여줄지만 적는다.
//
// 사실(fact)은 여기 없다: 도구 이름·도메인 소속·개수·W/D 분류·폐기 별칭은 전부
// packages/mcp-server/tool-manifest.json 에서 읽는다. 이 파일은 그 위에 얹는 사람의 선택이다 —
// 영어 라벨, README 에 내세울 대표 도구, 카탈로그의 도구별 메모·묶음, agent-guide §0 의 `select:` 배치.
//
// 도구를 **추가**할 때는 보통 이 파일을 건드릴 필요가 없다: 카탈로그·개수·README 는 manifest 에서
// 다시 그려지고, 새 도구는 자기 도메인의 `fallbackFor` 배치에 자동으로 붙는다.
// 도구를 **개명·삭제**하면 여기 적힌 옛 이름을 gen-docs 가 에러로 짚어 준다.
// **도메인**을 추가하면 domains · catalog · batches 에 자리를 만들라고 gen-docs 가 알려 준다.
//
// 고친 뒤: `npm run plugin:sync` (루트) — 생성 블록을 다시 쓰고 배포 사본까지 맞춘다.

/**
 * 도메인 표시 순서 + 영어 라벨 + README 대표 도구.
 * - 키 순서 = 카탈로그 "Counts by domain" 표와 세 README 도구 표의 행 순서.
 * - `en`: 영어 문서(카탈로그·README.md)의 라벨. 한국어 README 는 manifest 의 `label` 을 쓴다 —
 *   README 에서만 더 자세히 보여야 할 때에 한해 `ko` 로 덮어쓴다.
 * - `highlights`: README "Key Tools / 주요 도구" 열. 그 도메인의 정식(폐기 아님) 도구만.
 */
export const domains = {
  appstore: {
    en: 'App Store Connect',
    highlights: ['appstore_submit_for_review', 'appstore_get_weekly_insight', 'appstore_update_product_review_note', 'appstore_upload_product_review_screenshot'],
  },
  playstore: {
    en: 'Google Play',
    highlights: ['playstore_submit_release', 'playstore_promote_release', 'playstore_replace_images', 'playstore_reply_review', 'playstore_verify_service_account'],
  },
  firebase: {
    en: 'Firebase',
    highlights: ['firebase_create_project', 'firebase_get_remote_config_overview', 'firebase_get_android_config', 'firebase_create_ios_app'],
  },
  admob: {
    en: 'AdMob',
    highlights: ['admob_list_apps', 'admob_create_ad_unit', 'admob_get_today_earnings', 'admob_get_report'],
  },
  ci: {
    en: 'CI (GitHub Actions / GitLab)',
    highlights: ['ci_trigger_build', 'ci_get_build_status', 'ci_list_workflows', 'ci_cancel_build'],
  },
  jenkins: {
    en: 'Jenkins (credentials + jobs)',
    ko: 'Jenkins (크리덴셜 + 잡)',
    highlights: ['jenkins_create_credential', 'jenkins_upload_keystore', 'jenkins_create_job', 'jenkins_update_job'],
  },
  ga4: {
    en: 'GA4',
    highlights: ['ga4_create_property', 'ga4_create_data_stream', 'ga4_plan_bigquery_link', 'ga4_create_bigquery_link', 'ga4_run_report'],
  },
  gsc: {
    en: 'Search Console',
    highlights: ['gsc_inspect_url', 'gsc_search_analytics', 'gsc_submit_sitemap'],
  },
  googleads: {
    en: 'Google Ads',
    highlights: ['googleads_list_campaigns', 'googleads_get_uac_report', 'googleads_get_campaign_report'],
  },
  facebook: {
    en: 'Facebook',
    highlights: ['facebook_post_photo', 'facebook_post_multi_photo', 'facebook_list_pages'],
  },
  iam: {
    en: 'Google Cloud IAM',
    highlights: ['iam_create_service_account', 'iam_create_key', 'iam_add_iam_policy_binding'],
  },
  bigquery: {
    en: 'BigQuery',
    highlights: ['bigquery_run_query', 'bigquery_list_datasets', 'bigquery_get_table_schema'],
  },
  billing: {
    en: 'GCP Billing',
    highlights: ['gcp_get_billing_info', 'gcp_list_billing_projects', 'gcp_list_budgets', 'gcp_create_budget'],
  },
  threads: {
    en: 'Threads',
    highlights: ['threads_post', 'threads_post_video', 'threads_post_carousel', 'threads_refresh_token'],
  },
  tiktok: {
    en: 'TikTok Business',
    highlights: ['tiktok_business_plan_video_post', 'tiktok_business_publish_video', 'tiktok_business_get_publish_status'],
  },
  checks: {
    en: 'Checks / Risk',
    highlights: ['playstore_check_submission_risks', 'appstore_check_submission_risks', 'android_check_billing_compliance', 'screenshot_validate', 'release_status'],
  },
  instagram: {
    en: 'Instagram',
    highlights: ['instagram_post_image', 'instagram_post_carousel', 'instagram_save_config'],
  },
  android: {
    en: 'Android signing',
    highlights: ['android_signing_setup', 'android_generate_keystore', 'jenkins_upload_playstore_sa'],
  },
  auth: {
    en: 'Auth',
    highlights: ['mimi_seed_status', 'mimi_seed_auth_start', 'mimi_seed_auth_status', 'mimi_seed_remote_sync_credentials'],
  },
  ai: {
    en: 'AI',
    highlights: ['generate_release_notes_from_commits', 'generate_review_reply'],
  },
  video: {
    en: 'Video production',
    highlights: ['youtube_upload_video', 'youtube_get_video_status', 'youtube_update_video_privacy', 'video_plan_from_story', 'video_research_youtube', 'video_render'],
  },
  youtube: {
    en: 'YouTube',
    highlights: [
      'youtube_get_channel', 'youtube_list_videos', 'youtube_get_analytics_report', 'youtube_get_content_insights',
      'youtube_update_video_metadata', 'youtube_set_thumbnail', 'youtube_schedule_video', 'youtube_list_comments',
      'youtube_list_comment_replies', 'youtube_reply_comment',
    ],
  },
};

/**
 * docs/domain/tool-catalog.md. 모든 도메인은 `sections`(자기 `##` 섹션, 불릿) 또는 `tables`(묶음 표의 한 행)
 * 중 정확히 한 곳에 나온다. 도구 순서는 manifest 순서, 분류(Read / **W** / **D**)는 manifest 의
 * write · destructive 목록이 정한다 — 여기서 고르지 않는다.
 */
export const catalog = {
  /**
   * `layout`: 불릿 순서. 'R' | 'W' | 'D' = 그 분류의 "나머지" 도구 한 불릿, 객체 = 따로 묶은 불릿
   * (`label` 선택, `tools` 는 그 도메인 도구, `after` 는 불릿 끝에 붙는 산문). 생략하면 ['R', 'W', 'D'].
   * `impl`: 섹션 제목의 "· impl `…`" 부분.
   */
  sections: {
    playstore: { impl: 'playstore/tools.ts' },
    appstore: {
      impl: 'appstore/tools.ts',
      layout: [
        'R',
        { label: '분석/매출', tools: ['appstore_get_sales_report', 'appstore_get_finance_report'] },
        { tools: ['appstore_get_weekly_insight', 'appstore_upload_preview'] },
        { label: 'TestFlight', tools: ['appstore_update_beta_review_detail', 'appstore_update_beta_test_info', 'appstore_update_whats_to_test'] },
        'W',
        'D',
      ],
    },
    firebase: {},
    video: {
      impl: 'video/*.ts',
      layout: [
        'R',
        { label: 'research (saves under `research/`)', tools: ['video_research_youtube', 'video_search_stock_assets'] },
        {
          tools: ['youtube_upload_video', 'youtube_update_video_privacy'],
          after: '— private 업로드·비공개 전환은 되돌릴 수 있어 W; 공개 경로는 `confirmVisible` 이 막는다',
        },
        'W',
        'D',
      ],
    },
    youtube: { impl: 'youtube/*.ts' },
    tiktok: { impl: 'tiktok-business/*.ts' },
  },

  /** 묶음 표: 행 = [도메인, 라벨 뒤에 붙는 설명(선택)]. 표 안에서는 W/D 마커가 도구마다 붙는다. */
  tables: {
    cloud: {
      header: 'Tools (W = write, D = destructive)',
      rows: [
        ['admob'], ['iam'], ['billing'], ['bigquery'], ['ga4'], ['gsc'], ['googleads'], ['facebook'], ['instagram'],
        ['threads', '— Meta Threads Graph API, **text-first** (IG 와 별개 계정·토큰)'],
      ],
    },
    build: {
      header: 'Tools',
      rows: [
        ['ci', '— **not** Jenkins builds'],
        ['jenkins', '— **no build trigger**'],
        ['android'],
      ],
    },
    cross: {
      header: 'Tools',
      rows: [['checks'], ['auth'], ['ai', '— needs `ANTHROPIC_API_KEY`']],
    },
  },

  /** 도구 이름 뒤 괄호에 붙는 메모. 폐기 별칭 표기(**deprecated alias** → …)는 manifest 에서 자동으로 붙는다. */
  notes: {
    // Google Play
    playstore_get_financial_report: 'GCS 재무 CSV — Play API 엔 매출 엔드포인트가 없다',
    playstore_create_recovery_action: 'DRAFT 생성 — 아직 사용자에게 안 나감',
    playstore_update_details: 'developer contact + default language — `edits.details.patch`, distinct from the store listing',
    playstore_update_release_notes: 'versionCode 생략 = 트랙 최신 릴리스, `syncTracks` 지원',
    playstore_update_product_state: 'DRAFT ↔ 활성',
    setup_playstore_connection: 'SA 키 발급 + 로컬 등록 SA 덮어쓰기',
    playstore_deploy_recovery_action: '원격 인앱 업데이트 실배포',
    playstore_promote_release: 'draft 포함 모든 status 가 confirm 필요',
    playstore_replace_images: '기존 이미지 deleteall 후 업로드',
    playstore_upload_data_safety: '데이터 안전 CSV — 기존 제출 전체 덮어씀',
    playstore_reply_review: 'public',
    playstore_delete_service_account: '로컬 SA 파일 삭제',
    // App Store Connect
    appstore_get_sales_report: 'Sales and Trends — sandbox 가 섞이지 않는 실매출 기준선',
    appstore_get_finance_report: '정산 — reportDate 는 **Apple 회계월**',
    appstore_get_weekly_insight:
      'Analytics 주간 변화에서 제품 페이지·획득·수익화 중 한 가지 개선안을 선택 — 기본은 읽기; ONGOING report request 생성은 `confirmCreate` 필요',
    appstore_upload_preview: '제품 페이지 미리보기 동영상 — 커밋 후 Apple 인코딩 남음',
    appstore_update_age_rating: '심사 제출 전 필수',
    appstore_declare_encryption: '수출 규정 신고',
    appstore_attach_build: 'buildId 생략 = 최신 VALID 빌드',
    appstore_update_release_type: 'MANUAL / AFTER_APPROVAL / SCHEDULED 전환',
    appstore_delete_preview: '동영상·세트 삭제',
    appstore_add_beta_testers: '초대 메일 즉시 발송',
    appstore_notify_beta_testers: '테스터 전원 알림',
    appstore_submit_beta_review: 'Apple 베타 심사 시작',
    appstore_set_beta_group_build: '외부 그룹이면 실배포/회수',
    appstore_release_version: '즉시 공개',
    appstore_phased_release:
      '`complete`/`disable` 만 confirm — 남은 사용자 전체 공개; `enable`/`pause`/`resume` 은 되돌릴 수 있어 바로 실행',
    appstore_set_territory_availability: '지역 판매 on/off — `available=false` 는 판매 중단',
    appstore_add_product_to_review: 'IAP 단독 심사 즉시 제출',
    appstore_reply_review: 'public',
    // Firebase
    firebase_get_remote_config_overview: '일일 fetch·무료 한도 경고·실험/rollout 상태',
    firebase_create_project: 'new GCP project + addFirebase, polls 2 long-running operations',
    // Cloud & growth
    iam_create_key: 'issues a permanent private key, saved to `~/.mimi-seed/keys/`; only the path is returned',
    iam_add_iam_policy_binding: 'project IAM policy read-modify-write',
    gcp_list_billing_projects: '공용 결제계정 판별',
    gcp_create_budget: '알림만 — 지출 차단 아님',
    bigquery_run_query: 'read-only — a single `SELECT` enforced by a dry run; can incur cost',
    ga4_create_bigquery_link: 'confirm 필요, 기존 링크는 no-op',
    googleads_save_config: 'local config',
    facebook_post_photo: 'public',
    facebook_post_multi_photo: 'public',
    instagram_post_image: 'public',
    instagram_post_carousel: 'public',
    threads_post: 'public; text or image',
    threads_post_video: 'public; public video URL',
    threads_post_carousel: 'public; 2–20',
    // Build / CI / signing
    jenkins_upload_keystore: '새 id 는 바로 생성, 기존 id 교체만 confirm',
    jenkins_create_job: '`overwrite=true` replaces',
    jenkins_update_job: 'replaces config.xml',
    // Cross-cutting
    mimi_seed_auth_start: 'local callback server + token write',
    mimi_seed_remote_sync_credentials: 'confirm-gated secret upload',
    // Video production
    video_research_youtube: 'metadata/reference-only',
    youtube_upload_video:
      'profile로 계정 선택, expectedChannelId 필수·실제 채널 검증, 기본 private, public/unlisted는 명시 확인 필수',
    youtube_update_video_privacy: 'public/unlisted는 명시 확인 필수',
    video_plan_from_story: 'Anthropic + local project',
    video_save_plan: 'agent-authored storyboard, no API key — free-path default',
    video_synthesize_research: 'metadata/user notes → bounded brief',
    video_download_stock_assets: 'Pexels, preview then confirm',
    video_generate_image: 'OpenAI, preview then confirm',
    video_render: 'local FFmpeg job, preview then confirm',
    // YouTube
    youtube_reply_comment: 'agent-authored supplied text; preview by default, explicit confirmation required for public posting',
    // TikTok Business
    tiktok_business_plan_video_post: 'local validation plan + SHA-256 dedup record',
    tiktok_business_get_publish_status: 'provider read + local audit update',
    tiktok_business_publish_video:
      'owned Business Account에 공개 게시 — 명시 확인 필수, 원자적 중복 예약, POST 결과 불명 시 자동 재시도 금지',
  },
};

/**
 * 세 README 의 도구 표. 표 모양(열·굵게·구분자)은 README 마다 원래 모양을 그대로 따른다.
 * `heading` 의 {domains} 는 도메인 개수로 치환된다. `label`: 'en' = 위 `domains.*.en`, 'ko' = manifest `label`.
 */
export const readmes = [
  {
    file: 'README.md',
    heading: '## Local MCP Tool List (150+ tools · {domains} domains)',
    header: ['| Domain | Count | Key Tools |', '|--------|-------|-----------|'],
    label: 'en',
    bold: true,
    separator: ' · ',
  },
  {
    file: 'README.ko.md',
    heading: '## 도구 목록 (Local MCP · 150+ 개 · {domains}개 영역)',
    header: ['| 영역 | 도구 수 | 주요 도구 |', '|------|---------|-----------|'],
    label: 'ko',
    bold: true,
    separator: ' · ',
  },
  {
    file: 'packages/mcp-server/README.md',
    heading: '## 제공 도구 (150+ 개 · {domains}개 영역)',
    header: ['| 영역 | 도구 수 | 주요 도구 |', '|------|---------|-----------|'],
    label: 'ko',
    bold: false,
    separator: ' / ',
  },
];

/**
 * docs/agent-guide.md §0 의 `select:` 배치 (표 한 행 = 한 배치). **인벤토리 계약**: 정식 도구는 전부 최소 한
 * 배치에 들어가고, 폐기 별칭은 어디에도 들어가지 않는다 — gen-docs 가 강제한다.
 *
 * - `tools`: 이 순서대로 나열. `domains`: 그 도메인의 정식 도구 전부(manifest 순서)를 이어 붙인다.
 * - `fallbackFor`: 그 도메인의 도구 중 **어느 배치에도 없는 것**을 이 배치 끝에 자동으로 붙인다.
 *   모든 도메인은 어떤 배치의 `domains` 나 `fallbackFor` 에 있어야 한다 — 그래서 새 도구가 배치에서
 *   빠지는 일이 구조적으로 없다. 더 알맞은 배치가 있으면 그 배치의 `tools` 로 옮기면 된다.
 */
export const batches = [
  {
    goal: 'First contact / "what\'s connected?"',
    tools: ['mimi_seed_status', 'mimi_seed_auth_status', 'mimi_seed_auth_start', 'mimi_seed_remote_sync_credentials'],
    fallbackFor: ['auth'],
  },
  {
    goal: 'Release readiness (either store)',
    tools: ['release_status', 'playstore_check_submission_risks', 'appstore_check_submission_risks', 'screenshot_validate'],
    fallbackFor: ['checks'],
  },
  {
    goal: 'Android Billing compliance',
    tools: ['android_check_billing_compliance', 'playstore_check_submission_risks'],
  },
  {
    goal: 'Play Store release',
    tools: [
      'playstore_get_app', 'playstore_list_tracks', 'playstore_update_release_notes', 'playstore_promote_release',
      'playstore_submit_release', 'playstore_check_submission_risks', 'playstore_plan_release',
    ],
    fallbackFor: ['playstore'],
  },
  {
    goal: 'Play Store listing + images',
    tools: [
      'playstore_get_listing', 'playstore_update_listing', 'playstore_update_details', 'playstore_upload_image',
      'playstore_list_images', 'playstore_replace_images', 'playstore_delete_all_images',
    ],
  },
  {
    goal: 'Play Store reviews + stats',
    tools: ['playstore_list_reviews', 'playstore_reply_review', 'playstore_get_statistics', 'generate_review_reply'],
  },
  {
    goal: 'Play Store IAP / subscriptions',
    tools: [
      'playstore_list_products', 'playstore_list_inapp_products', 'playstore_list_subscriptions',
      'playstore_create_onetime_product', 'playstore_create_subscription', 'playstore_update_product',
      'playstore_update_product_listing', 'playstore_update_subscription_listing', 'playstore_update_product_state',
      'playstore_delete_product',
    ],
  },
  {
    goal: 'App Store / TestFlight',
    tools: [
      'appstore_list_apps', 'appstore_verify_credentials', 'appstore_get_app', 'appstore_list_versions',
      'appstore_create_version', 'appstore_get_metadata', 'appstore_update_whats_new', 'appstore_list_builds',
      'appstore_attach_build', 'appstore_list_beta_groups', 'appstore_submit_for_review',
      'appstore_check_submission_risks', 'appstore_plan_release',
    ],
    fallbackFor: ['appstore'],
  },
  {
    goal: 'App Store release control (after approval)',
    tools: [
      'appstore_release_status', 'appstore_release_version', 'appstore_update_release_type', 'appstore_phased_release',
      'appstore_list_versions',
    ],
  },
  {
    goal: 'Pre-submission declarations (both stores)',
    tools: [
      'appstore_get_age_rating', 'appstore_update_age_rating', 'appstore_declare_encryption', 'appstore_get_availability',
      'appstore_set_territory_availability', 'playstore_upload_data_safety',
    ],
  },
  {
    goal: 'TestFlight external testing',
    tools: [
      'appstore_beta_status', 'appstore_update_beta_review_detail', 'appstore_update_beta_test_info',
      'appstore_update_whats_to_test', 'appstore_submit_beta_review', 'appstore_set_beta_group_build',
      'appstore_add_beta_testers', 'appstore_notify_beta_testers', 'appstore_list_beta_groups', 'appstore_list_builds',
    ],
  },
  {
    goal: 'App Store review submission (the bundle)',
    tools: [
      'appstore_list_review_submissions', 'appstore_add_version_to_review_submission',
      'appstore_remove_review_submission_item', 'appstore_update_version_string', 'appstore_cancel_review',
    ],
  },
  {
    goal: 'App Store preview videos',
    tools: ['appstore_list_previews', 'appstore_upload_preview', 'appstore_delete_preview', 'appstore_get_metadata'],
  },
  {
    goal: 'Play post-release recovery',
    tools: [
      'playstore_list_recovery_actions', 'playstore_create_recovery_action', 'playstore_deploy_recovery_action',
      'playstore_cancel_recovery_action', 'playstore_list_tracks',
    ],
  },
  {
    goal: 'App Store screenshots',
    tools: [
      'appstore_list_app_info_localizations', 'appstore_get_metadata', 'appstore_list_screenshots',
      'appstore_upload_screenshot', 'appstore_delete_screenshot', 'appstore_delete_screenshot_set', 'screenshot_validate',
    ],
  },
  {
    goal: 'App Store app info + review notes',
    tools: [
      'appstore_get_app_info', 'appstore_update_app_info_localization', 'appstore_create_app_info_localization',
      'appstore_update_localization', 'appstore_get_review_notes', 'appstore_update_review_notes',
    ],
  },
  {
    goal: 'App Store reviews',
    tools: ['appstore_list_reviews', 'appstore_reply_review', 'generate_review_reply'],
  },
  {
    goal: 'App Store IAP (products + review metadata)',
    tools: [
      'appstore_list_products', 'appstore_create_inapp_purchase', 'appstore_create_subscription', 'appstore_update_product',
      'appstore_list_product_localizations', 'appstore_update_product_localization',
      'appstore_update_product_review_note', 'appstore_upload_product_review_screenshot',
      'appstore_add_product_to_review', 'appstore_delete_product',
    ],
  },
  {
    goal: 'Release notes from commits',
    tools: ['generate_release_notes_from_commits', 'playstore_update_release_notes', 'appstore_update_whats_new'],
    fallbackFor: ['ai'],
  },
  {
    goal: 'Firebase setup',
    tools: [
      'firebase_list_projects', 'firebase_get_project', 'firebase_create_project', 'firebase_create_android_app',
      'firebase_create_ios_app', 'firebase_get_android_config', 'firebase_get_ios_config',
      'firebase_enable_common_services',
    ],
  },
  {
    goal: 'Firebase apps + services (incl. web)',
    tools: [
      'firebase_list_android_apps', 'firebase_list_ios_apps', 'firebase_list_web_apps', 'firebase_create_web_app',
      'firebase_get_web_config', 'firebase_enable_service', 'firebase_list_enabled_services',
      'firebase_delete_android_app', 'firebase_delete_ios_app', 'firebase_delete_web_app',
    ],
    fallbackFor: ['firebase'],
  },
  {
    goal: 'Remote Config usage + experiments',
    tools: ['firebase_get_remote_config_overview', 'gcp_get_billing_info'],
  },
  {
    goal: 'Analytics wiring (Firebase ↔ GA4 ↔ BigQuery)',
    tools: [
      'firebase_link_analytics', 'firebase_get_analytics_details', 'ga4_list_account_summaries', 'ga4_list_properties',
      'ga4_create_property', 'ga4_list_data_streams', 'ga4_create_data_stream', 'ga4_plan_bigquery_link',
      'ga4_create_bigquery_link', 'ga4_run_report',
    ],
    fallbackFor: ['ga4'],
  },
  {
    goal: 'BigQuery',
    tools: ['bigquery_auth_status', 'bigquery_list_datasets', 'bigquery_list_tables', 'bigquery_get_table_schema', 'bigquery_run_query'],
    fallbackFor: ['bigquery'],
  },
  {
    goal: 'GCP billing (Blaze 여부 · 비용 범위 · 예산)',
    domains: ['billing'],
  },
  {
    goal: 'Real revenue (스토어 정산 원장 — sandbox·테스터가 섞이지 않는 유일한 창구)',
    tools: [
      'appstore_get_sales_report', 'appstore_get_finance_report', 'playstore_list_financial_reports',
      'playstore_get_financial_report',
    ],
  },
  {
    goal: 'App Store weekly growth insight',
    tools: ['appstore_get_weekly_insight', 'appstore_get_sales_report'],
  },
  {
    goal: 'AdMob',
    tools: [
      'admob_list_accounts', 'admob_list_apps', 'admob_create_app', 'admob_create_ad_unit', 'admob_list_ad_units',
      'admob_get_today_earnings', 'admob_get_report',
    ],
    fallbackFor: ['admob'],
  },
  {
    goal: 'Google Ads (UAC)',
    tools: [
      'googleads_config_status', 'googleads_save_config', 'googleads_list_accessible_customers',
      'googleads_list_campaigns', 'googleads_get_campaign_report', 'googleads_get_uac_report',
    ],
    fallbackFor: ['googleads'],
  },
  {
    goal: 'Search Console',
    domains: ['gsc'],
  },
  {
    goal: 'Social posting (Facebook / Instagram / Threads)',
    tools: [
      'facebook_current_config', 'facebook_save_config', 'facebook_list_pages', 'facebook_get_page', 'facebook_post_photo',
      'facebook_post_multi_photo', 'instagram_save_config', 'instagram_get_account', 'instagram_post_image',
      'instagram_post_carousel', 'threads_current_config', 'threads_save_config', 'threads_refresh_token',
      'threads_get_account', 'threads_post', 'threads_post_video', 'threads_post_carousel',
    ],
    fallbackFor: ['facebook', 'instagram', 'threads'],
  },
  {
    goal: 'TikTok Business video publish',
    domains: ['tiktok'],
  },
  {
    goal: 'Jenkins credentials + jobs',
    tools: [
      'jenkins_status', 'jenkins_save_config', 'jenkins_list_credentials', 'jenkins_create_credential',
      'jenkins_delete_credential', 'jenkins_upload_keystore', 'jenkins_upload_playstore_sa', 'jenkins_list_jobs',
      'jenkins_get_job_config', 'jenkins_create_job', 'jenkins_update_job',
    ],
    fallbackFor: ['jenkins'],
  },
  {
    goal: 'CI (GitHub/GitLab)',
    domains: ['ci'],
  },
  {
    goal: 'Android signing / keystore',
    tools: [
      'android_signing_setup', 'android_generate_keystore', 'jenkins_upload_keystore', 'jenkins_create_credential',
      'jenkins_upload_playstore_sa',
    ],
    fallbackFor: ['android'],
  },
  {
    goal: 'Service account end-to-end',
    tools: [
      'iam_list_service_accounts', 'iam_create_service_account', 'iam_list_keys', 'iam_create_key',
      'iam_add_iam_policy_binding', 'setup_playstore_connection', 'playstore_register_service_account',
      'playstore_verify_service_account', 'playstore_list_service_accounts', 'playstore_delete_service_account',
    ],
    fallbackFor: ['iam'],
  },
  {
    goal: 'Story → researched video',
    tools: [
      'video_save_plan', 'video_plan_from_story', 'video_research_youtube', 'video_search_stock_assets',
      'video_synthesize_research', 'video_download_stock_assets', 'video_generate_image', 'video_add_local_asset',
      'video_build_timeline', 'video_render', 'video_job_status', 'video_validate',
    ],
    fallbackFor: ['video'],
  },
  {
    goal: 'YouTube upload / publish',
    tools: [
      'youtube_upload_video', 'youtube_get_video_status', 'youtube_update_video_privacy', 'youtube_update_video_metadata',
      'youtube_set_thumbnail', 'youtube_schedule_video', 'mimi_seed_auth_start', 'mimi_seed_auth_status',
    ],
  },
  {
    goal: 'YouTube channel + analytics',
    tools: ['youtube_get_channel', 'youtube_list_videos', 'youtube_get_analytics_report', 'mimi_seed_auth_start', 'mimi_seed_auth_status'],
    fallbackFor: ['youtube'],
  },
  {
    goal: 'YouTube comments',
    tools: ['youtube_list_comments', 'youtube_list_comment_replies', 'youtube_reply_comment', 'mimi_seed_auth_start', 'mimi_seed_auth_status'],
  },
  {
    goal: 'YouTube content insights',
    tools: [
      'youtube_get_content_insights', 'youtube_get_channel', 'youtube_list_videos', 'video_save_plan',
      'mimi_seed_auth_start', 'mimi_seed_auth_status',
    ],
  },
];
