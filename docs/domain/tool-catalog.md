# Tool catalog

<!-- generated:catalog-total:start — edit scripts/docs-spec.mjs, then npm run plugin:sync -->
**247 tools across 23 domains** — per-domain counts below.
<!-- generated:catalog-total:end -->

> The MCP server's "entities". One row per domain → register file → tools, with **W** (write) and **D**
> (destructive / near-irreversible / outward-facing) markers. Everything unmarked is read-only.
>
> **Generated.** The total above, the counts table, and every tool list below — the blocks between
> `<!-- generated:… -->` markers — are written by `scripts/gen-docs.mjs` from
> `packages/mcp-server/tool-manifest.json`: inventory, counts, deprecated aliases, and the **W** / **D** markers
> (the manifest's `write` / `destructive` lists, which also become the MCP tool annotations — `readOnlyHint`,
> `destructiveHint`, … — and every **D** tool is confirm-gated by the registrar, [[architecture]]). English labels,
> per-tool notes, and bullet grouping come from `scripts/docs-spec.mjs`. Never edit inside a block: change the
> manifest or the spec, then `npm run plugin:sync` (`npm run plugin:check` fails on a stale block). The prose
> outside the blocks is hand-written. The manifest's `tools` lists are themselves test-enforced against the live
> registrations (`tool-manifest.test.ts`, [[pitfalls]] §8), so what is generated here is what the server registers.
> For *how to call* these in order, see [`../agent-guide.md`](../agent-guide.md); this doc is the inventory only.
>
> Reading the markers: within one bullet or table row, a **W** / **D** applies to every tool name after it until
> the next marker; a new bullet or row starts over as read-only. **D** tools that gate themselves (`ownGate` in the
> manifest) are listed in [`../agent-guide.md`](../agent-guide.md) §5.

## Counts by domain

<!-- generated:catalog-counts:start — edit scripts/docs-spec.mjs, then npm run plugin:sync -->
| Domain | Register file | Tools |
|--------|---------------|------:|
| App Store Connect | `registers/appstore.ts` → `registers/appstore/*.ts` | 63 |
| Google Play | `registers/playstore.ts` | 38 |
| Firebase | `registers/firebase.ts` | 21 |
| AdMob | `registers/admob.ts` | 7 |
| CI (GitHub Actions / GitLab) | `registers/ci.ts` | 6 |
| Jenkins (credentials + jobs + builds) | `registers/jenkins.ts` | 13 |
| GA4 | `registers/ga4.ts` | 8 |
| Search Console | `registers/gsc.ts` | 6 |
| Naver Search Advisor | `registers/naver.ts` | 2 |
| Google Ads | `registers/googleads.ts` | 6 |
| Facebook | `registers/facebook.ts` | 6 |
| Google Cloud IAM | `registers/iam.ts` | 5 |
| BigQuery | `registers/bigquery.ts` | 5 |
| GCP Billing | `registers/billing.ts` | 4 |
| Threads | `registers/threads.ts` | 7 |
| TikTok Business | `registers/tiktok.ts` | 7 |
| Checks / Risk | `registers/checks.ts` | 5 |
| Instagram | `registers/instagram.ts` | 4 |
| Android signing | `registers/android.ts` | 3 |
| Auth | `registers/auth.ts` | 4 |
| AI | `registers/ai.ts` | 2 |
| Video production | `registers/video.ts` | 15 |
| YouTube | `registers/youtube.ts` | 10 |
| **Total** | **23 modules** | **247** |
<!-- generated:catalog-counts:end -->

<!-- generated:catalog-domain:playstore:start — edit scripts/docs-spec.mjs, then npm run plugin:sync -->
## Google Play — `registers/playstore.ts` (38) · impl `playstore/*.ts`

- Read: `playstore_get_app` · `playstore_get_listing` · `playstore_list_tracks` · `playstore_get_statistics` ·
  `playstore_list_images` · `playstore_list_reviews` · `playstore_list_inapp_products` ·
  `playstore_list_subscriptions` · `playstore_verify_service_account` · `playstore_list_service_accounts` ·
  `playstore_plan_release` · `playstore_list_products` · `playstore_list_recovery_actions` ·
  `playstore_list_financial_reports` · `playstore_get_financial_report` (GCS 재무 CSV — Play API 엔 매출 엔드포인트가 없다)
- **W**
  `playstore_update_details` (developer contact + default language — `edits.details.patch`, distinct from the store listing) ·
  `playstore_update_listing` · `playstore_upload_image` ·
  `playstore_update_release_notes` (versionCode 생략 = 트랙 최신 릴리스, `syncTracks` 지원) ·
  `playstore_create_onetime_product` · `playstore_create_subscription` · `playstore_register_service_account` ·
  `playstore_update_product_listing` · `playstore_update_subscription_listing` ·
  `playstore_update_product_state` (DRAFT ↔ 활성) · `playstore_update_product` ·
  `playstore_create_recovery_action` (DRAFT 생성 — 아직 사용자에게 안 나감)
- **D** `playstore_delete_all_images` · `playstore_replace_images` (기존 이미지 deleteall 후 업로드) ·
  `playstore_reply_review` (public) · `playstore_delete_service_account` (로컬 SA 파일 삭제) ·
  `playstore_submit_release` · `playstore_promote_release` (draft 포함 모든 status 가 confirm 필요) ·
  `playstore_delete_product` · `setup_playstore_connection` (SA 키 발급 + 로컬 등록 SA 덮어쓰기) ·
  `playstore_upload_data_safety` (데이터 안전 CSV — 기존 제출 전체 덮어씀) · `playstore_deploy_recovery_action` (원격 인앱 업데이트 실배포) ·
  `playstore_cancel_recovery_action`
<!-- generated:catalog-domain:playstore:end -->
- `playstore_list_products` (서비스 계정 전용, 구독+일회성 요약) and `playstore_list_inapp_products` (OAuth 가능,
  `purchaseOptions` 포함 — 구매 옵션 활성화 토글의 입력) are **not** duplicates; both stay.

<!-- generated:catalog-domain:appstore:start — edit scripts/docs-spec.mjs, then npm run plugin:sync -->
## App Store Connect — `registers/appstore.ts` → `registers/appstore/*.ts` (63) · impl `appstore/*.ts`

- Read: `appstore_list_apps` · `appstore_verify_credentials` · `appstore_get_app` · `appstore_list_versions` ·
  `appstore_get_metadata` · `appstore_list_screenshots` · `appstore_get_review_notes` · `appstore_list_builds` ·
  `appstore_list_beta_groups` · `appstore_get_app_info` · `appstore_list_app_info_localizations` ·
  `appstore_list_reviews` · `appstore_list_products` · `appstore_list_product_localizations` ·
  `appstore_plan_release` · `appstore_list_review_submissions` · `appstore_release_status` ·
  `appstore_get_age_rating` · `appstore_get_availability` · `appstore_beta_status` · `appstore_list_previews`
- Read (분석/매출): `appstore_get_sales_report` (Sales and Trends — sandbox 가 섞이지 않는 실매출 기준선) ·
  `appstore_get_finance_report` (정산 — reportDate 는 **Apple 회계월**)
- **W**
  `appstore_get_weekly_insight` (Analytics 주간 변화에서 제품 페이지·획득·수익화 중 한 가지 개선안을 선택 — 기본은 읽기; ONGOING report request 생성은 `confirmCreate` 필요) ·
  `appstore_upload_preview` (제품 페이지 미리보기 동영상 — 커밋 후 Apple 인코딩 남음)
- **W** TestFlight: `appstore_update_beta_review_detail` · `appstore_update_beta_test_info` ·
  `appstore_update_whats_to_test`
- **W** `appstore_create_version` · `appstore_attach_build` (buildId 생략 = 최신 VALID 빌드) ·
  `appstore_update_localization` · `appstore_upload_screenshot` · `appstore_update_whats_new` ·
  `appstore_update_review_notes` · `appstore_update_app_info_localization` ·
  `appstore_create_app_info_localization` · `appstore_create_inapp_purchase` · `appstore_create_subscription` ·
  `appstore_update_product_review_note` · `appstore_update_product_localization` ·
  `appstore_upload_product_review_screenshot` · `appstore_update_product` ·
  `appstore_add_version_to_review_submission` · `appstore_update_version_string` ·
  `appstore_update_release_type` (MANUAL / AFTER_APPROVAL / SCHEDULED 전환) ·
  `appstore_update_age_rating` (심사 제출 전 필수) · `appstore_declare_encryption` (수출 규정 신고)
- **D** `appstore_delete_screenshot` · `appstore_delete_screenshot_set` · `appstore_reply_review` (public) ·
  `appstore_add_product_to_review` (IAP 단독 심사 즉시 제출) · `appstore_delete_product` · `appstore_submit_for_review` ·
  `appstore_remove_review_submission_item` · `appstore_cancel_review` · `appstore_release_version` (즉시 공개) ·
  `appstore_phased_release` (`complete`/`disable` 만 confirm — 남은 사용자 전체 공개; `enable`/`pause`/`resume` 은 되돌릴 수 있어 바로 실행) ·
  `appstore_set_territory_availability` (지역 판매 on/off — `available=false` 는 판매 중단) ·
  `appstore_submit_beta_review` (Apple 베타 심사 시작) · `appstore_set_beta_group_build` (외부 그룹이면 실배포/회수) ·
  `appstore_add_beta_testers` (초대 메일 즉시 발송) · `appstore_notify_beta_testers` (테스터 전원 알림) ·
  `appstore_delete_preview` (동영상·세트 삭제)
<!-- generated:catalog-domain:appstore:end -->
- `appstore_release_status` (versionId 하나의 출시·단계적 출시 상세) and `release_status` in Checks (버전 문자열로
  두 스토어를 한 번에) answer different questions; both stay.

<!-- generated:catalog-domain:firebase:start — edit scripts/docs-spec.mjs, then npm run plugin:sync -->
## Firebase — `registers/firebase.ts` (21)

- Read: `firebase_list_projects` · `firebase_get_project` · `firebase_list_android_apps` ·
  `firebase_get_android_config` · `firebase_list_ios_apps` · `firebase_get_ios_config` · `firebase_list_web_apps` ·
  `firebase_get_web_config` · `firebase_list_enabled_services` · `firebase_get_analytics_details` ·
  `firebase_get_remote_config_overview` (일일 fetch·무료 한도 경고·실험/rollout 상태)
- **W** `firebase_create_project` (new GCP project + addFirebase, polls 2 long-running operations) ·
  `firebase_create_android_app` · `firebase_create_ios_app` · `firebase_create_web_app` ·
  `firebase_enable_service` · `firebase_enable_common_services` · `firebase_link_analytics`
- **D** `firebase_delete_android_app` · `firebase_delete_ios_app` · `firebase_delete_web_app`
<!-- generated:catalog-domain:firebase:end -->

## Cloud & growth domains

<!-- generated:catalog-table:cloud:start — edit scripts/docs-spec.mjs, then npm run plugin:sync -->
| Domain (file) | Tools (W = write, D = destructive) |
|---|---|
| AdMob (`admob.ts`) | `admob_list_accounts` · `admob_list_apps` · `admob_list_ad_units` · `admob_get_today_earnings` · `admob_get_report` · **W** `admob_create_app` · **W** `admob_create_ad_unit` |
| Google Cloud IAM (`iam.ts`) | `iam_list_service_accounts` · `iam_list_keys` · **W** `iam_create_service_account` · **D** `iam_create_key` (issues a permanent private key, saved to `~/.mimi-seed/keys/`; only the path is returned) · **D** `iam_add_iam_policy_binding` (project IAM policy read-modify-write) |
| GCP Billing (`billing.ts`) | `gcp_get_billing_info` · `gcp_list_billing_projects` (공용 결제계정 판별) · `gcp_list_budgets` · **W** `gcp_create_budget` (알림만 — 지출 차단 아님) |
| BigQuery (`bigquery.ts`) | `bigquery_run_query` (read-only — a single `SELECT` enforced by a dry run; can incur cost) · `bigquery_list_datasets` · `bigquery_list_tables` · `bigquery_get_table_schema` · `bigquery_auth_status` |
| GA4 (`ga4.ts`) | `ga4_list_account_summaries` · `ga4_list_properties` · `ga4_list_data_streams` · `ga4_plan_bigquery_link` · `ga4_run_report` · **W** `ga4_create_property` · **W** `ga4_create_data_stream` · **W** `ga4_create_bigquery_link` (confirm 필요, 기존 링크는 no-op) |
| Search Console (`gsc.ts`) | `gsc_list_sites` · `gsc_list_sitemaps` · `gsc_get_sitemap` · `gsc_inspect_url` · `gsc_search_analytics` · **W** `gsc_submit_sitemap` |
| Naver Search Advisor (`naver.ts`) — no public Search Advisor API: crawler-view check + IndexNow | `naver_check_page` · **W** `naver_indexnow_submit` |
| Google Ads (`googleads.ts`) | `googleads_list_campaigns` · `googleads_get_campaign_report` · `googleads_get_uac_report` · `googleads_list_accessible_customers` · `googleads_config_status` · **W** `googleads_save_config` (local config) |
| Facebook (`facebook.ts`) | `facebook_list_pages` · `facebook_get_page` · `facebook_current_config` · **W** `facebook_save_config` · **D** `facebook_post_photo` (public) · **D** `facebook_post_multi_photo` (public) |
| Instagram (`instagram.ts`) | `instagram_get_account` · **W** `instagram_save_config` · **D** `instagram_post_image` (public) · **D** `instagram_post_carousel` (public) |
| Threads (`threads.ts`) — Meta Threads Graph API, **text-first** (IG 와 별개 계정·토큰) | `threads_get_account` · `threads_current_config` · **W** `threads_save_config` · **W** `threads_refresh_token` · **D** `threads_post` (public; text or image) · **D** `threads_post_video` (public; public video URL) · **D** `threads_post_carousel` (public; 2–20) |
<!-- generated:catalog-table:cloud:end -->

## Build / CI / signing

<!-- generated:catalog-table:build:start — edit scripts/docs-spec.mjs, then npm run plugin:sync -->
| Domain (file) | Tools |
|---|---|
| CI (GitHub Actions / GitLab) (`ci.ts`) — **not** Jenkins builds | `ci_list_workflows` · `ci_get_build_status` · `ci_list_recent_builds` · **W** `ci_save_config` · **W** `ci_trigger_build` · **D** `ci_cancel_build` |
| Jenkins (credentials + jobs + builds) (`jenkins.ts`) — builds: `jenkins_trigger_build` → `jenkins_get_queue_item` → `jenkins_get_build_status` | `jenkins_status` · `jenkins_list_credentials` · `jenkins_list_jobs` · `jenkins_get_job_config` · `jenkins_get_queue_item` · `jenkins_get_build_status` · **W** `jenkins_save_config` · **D** `jenkins_create_credential` · **D** `jenkins_upload_keystore` (새 id 는 바로 생성, 기존 id 교체만 confirm) · **D** `jenkins_delete_credential` · **D** `jenkins_create_job` (`overwrite=true` replaces) · **D** `jenkins_update_job` (replaces config.xml) · **D** `jenkins_trigger_build` (confirm 필요; 같은 `request_id` 는 로컬 기록으로 한 번만 발송) |
| Android signing (`android.ts`) | `android_signing_setup` · **W** `android_generate_keystore` · **D** `jenkins_upload_playstore_sa` (새 id 는 바로 생성, 기존 id 교체만 confirm) |
<!-- generated:catalog-table:build:end -->

## Cross-cutting

<!-- generated:catalog-table:cross:start — edit scripts/docs-spec.mjs, then npm run plugin:sync -->
| Domain (file) | Tools |
|---|---|
| Checks / Risk (`checks.ts`) | `playstore_check_submission_risks` · `appstore_check_submission_risks` · `android_check_billing_compliance` · `screenshot_validate` · `release_status` |
| Auth (`auth.ts`) | `mimi_seed_status` · `mimi_seed_auth_status` · **W** `mimi_seed_auth_start` (local callback server + token write) · **W** `mimi_seed_remote_sync_credentials` (confirm-gated secret upload) |
| AI (`ai.ts`) — needs `ANTHROPIC_API_KEY` | `generate_release_notes_from_commits` · `generate_review_reply` |
<!-- generated:catalog-table:cross:end -->

<!-- generated:catalog-domain:video:start — edit scripts/docs-spec.mjs, then npm run plugin:sync -->
## Video production — `registers/video.ts` (15) · impl `video/*.ts`

- Read: `youtube_get_video_status` · `video_job_status` · `video_validate`
- **W** research (saves under `research/`): `video_research_youtube` (metadata/reference-only) ·
  `video_search_stock_assets`
- **W**
  `youtube_upload_video` (profile로 계정 선택, expectedChannelId 필수·실제 채널 검증, 기본 private, public/unlisted는 명시 확인 필수) ·
  `youtube_update_video_privacy` (public/unlisted는 명시 확인 필수)
  — private 업로드·비공개 전환은 되돌릴 수 있어 W; 공개 경로는 `confirmVisible` 이 막는다
- **W** `video_plan_from_story` (Anthropic + local project) ·
  `video_save_plan` (agent-authored storyboard, no API key — free-path default) ·
  `video_synthesize_research` (metadata/user notes → bounded brief) ·
  `video_download_stock_assets` (Pexels, preview then confirm) ·
  `video_generate_image` (OpenAI, preview then confirm) · `video_add_local_asset` · `video_build_timeline` ·
  `video_render` (local FFmpeg job, preview then confirm)
<!-- generated:catalog-domain:video:end -->
- YouTube results are permanently marked `reference-only`; only assets with recorded provenance and
  `allowedForRendering=true` can enter a timeline.

<!-- generated:catalog-domain:youtube:start — edit scripts/docs-spec.mjs, then npm run plugin:sync -->
## YouTube — `registers/youtube.ts` (10) · impl `youtube/*.ts`

- Read: `youtube_get_channel` · `youtube_list_videos` · `youtube_get_analytics_report` · `youtube_list_comments` ·
  `youtube_list_comment_replies` · `youtube_get_content_insights`
- **W** `youtube_update_video_metadata` · `youtube_set_thumbnail` · `youtube_schedule_video`
- **D**
  `youtube_reply_comment` (agent-authored supplied text; preview by default, explicit confirmation required for public posting)
<!-- generated:catalog-domain:youtube:end -->
- `youtube_get_content_insights` is a bounded current-vs-previous-period evidence brief with a ranked
  metadata sample; it does not call an AI API or generate a storyboard.
- All YouTube writes preview by default and require explicit confirmation before the provider write.
- Analytics reports use the separate `youtube_analytics` OAuth domain (`youtube.readonly` and
  `yt-analytics.readonly`); channel and video-list reads also accept the publishing `youtube` grant.
  The tools accept an optional named `profile` and channel expectation for multi-channel accounts;
  they do not grant or alter publishing access.

<!-- generated:catalog-domain:tiktok:start — edit scripts/docs-spec.mjs, then npm run plugin:sync -->
## TikTok Business — `registers/tiktok.ts` (7) · impl `tiktok-business/*.ts`

- Read: `tiktok_business_auth_status` · `tiktok_business_get_account` · `tiktok_business_get_video_settings` ·
  `tiktok_business_list_publish_audits`
- **W** `tiktok_business_plan_video_post` (local validation plan + SHA-256 dedup record) ·
  `tiktok_business_get_publish_status` (provider read + local audit update)
- **D**
  `tiktok_business_publish_video` (owned Business Account에 공개 게시 — 명시 확인 필수, 원자적 중복 예약, POST 결과 불명 시 자동 재시도 금지)
<!-- generated:catalog-domain:tiktok:end -->

## Quirks worth knowing (tool name ≠ register file)

- **`checks.ts` owns the `*_check_submission_risks` and `release_status` tools**, not `playstore.ts` /
  `appstore.ts`. Search by the `server.tool('name'` string, not by the name prefix, when locating a tool.
- **`android.ts` registers `jenkins_upload_playstore_sa`** (a `jenkins_`-prefixed tool) because it is part of
  the Android signing setup flow.
- `setup_playstore_connection` lives in `playstore.ts` despite the un-prefixed name.

## Safety

The **D**-marked tools (submit/promote/cancel/delete/public posts) are near-irreversible or outward facing;
the registrar makes each of them return a dry-run preview unless called with `confirm: true` (or the tool's own
`confirmPublish` / `confirmVisible` flag). The runtime confirmation policy lives in [`../agent-guide.md`](../agent-guide.md) §5 and the
`mimi-seed://agent/guide` resource — do not restate it here; this catalog only flags which tools are sensitive.
