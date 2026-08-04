# Tool catalog — 226 tools across 21 domains

> The MCP server's "entities". One row per domain → register file → tools, with **W** (write) and **D**
> (destructive / near-irreversible) markers. Everything unmarked is read-only.
>
> SSOT: `packages/mcp-server/tool-manifest.json` (test-enforced against the live `server.tool(…)`
> registrations — see [[pitfalls]] §8). Update the manifest and this catalog together when tools change.
> For *how to call* these in order, see [`../agent-guide.md`](../agent-guide.md); this doc is the inventory only.

## Counts by domain

| Domain | Register file | Tools |
|--------|---------------|------:|
| App Store Connect | `registers/appstore.ts` | 61 |
| Google Play | `registers/playstore.ts` | 37 |
| Firebase | `registers/firebase.ts` | 20 |
| AdMob | `registers/admob.ts` | 7 |
| CI (GitHub/GitLab) | `registers/ci.ts` | 6 |
| Jenkins (credentials + jobs) | `registers/jenkins.ts` | 10 |
| GA4 | `registers/ga4.ts` | 8 |
| Search Console | `registers/gsc.ts` | 6 |
| Google Ads | `registers/googleads.ts` | 6 |
| Facebook | `registers/facebook.ts` | 6 |
| Google Cloud IAM | `registers/iam.ts` | 5 |
| BigQuery | `registers/bigquery.ts` | 5 |
| GCP Billing | `registers/billing.ts` | 4 |
| Threads | `registers/threads.ts` | 7 |
| TikTok Business | `registers/tiktok.ts` | 7 |
| Instagram | `registers/instagram.ts` | 4 |
| Checks | `registers/checks.ts` | 4 |
| Auth | `registers/auth.ts` | 4 |
| Android signing | `registers/android.ts` | 3 |
| AI | `registers/ai.ts` | 2 |
| Video production | `registers/video.ts` | 14 |
| **Total** | **21 modules** | **226** |

## Google Play — `registers/playstore.ts` (37) · impl `playstore/tools.ts`

- Read: `playstore_list_recovery_actions` · `playstore_get_app` · `playstore_get_listing` · `playstore_list_tracks` · `playstore_get_statistics` ·
  `playstore_list_images` · `playstore_list_reviews` · `playstore_list_inapp_products` ·
  `playstore_list_subscriptions` · `playstore_list_products` · `playstore_list_service_accounts` ·
  `playstore_verify_service_account` · `playstore_plan_release`
- **W** `playstore_create_recovery_action` (DRAFT 생성 — 아직 사용자에게 안 나감) ·
  `playstore_upload_data_safety` (데이터 안전 CSV — 기존 제출 전체 덮어씀, confirm 게이트) ·
  `playstore_update_listing` · `playstore_update_details` (developer contact + default language —
  `edits.details.patch`, distinct from the store listing) · `playstore_upload_image` · `playstore_replace_images` ·
  `playstore_update_release_notes` · `playstore_update_latest_release_notes` · `playstore_reply_review` (public) ·
  `playstore_create_onetime_product` · `playstore_create_subscription` · `playstore_update_product` ·
  `playstore_update_product_listing` · `playstore_update_subscription_listing` ·
  `playstore_update_product_state` (DRAFT ↔ 활성) ·
  `playstore_register_service_account` · `setup_playstore_connection`
- **D** `playstore_deploy_recovery_action` (원격 인앱 업데이트 실배포) ·
  `playstore_cancel_recovery_action` · `playstore_submit_release` · `playstore_promote_release` · `playstore_delete_all_images` ·
  `playstore_delete_product` · `playstore_delete_service_account`

## App Store Connect — `registers/appstore.ts` (61) · impl `appstore/tools.ts`

- Read: `appstore_list_apps` · `appstore_verify_credentials` · `appstore_get_app` · `appstore_list_versions` ·
  `appstore_get_metadata` · `appstore_list_screenshots` · `appstore_get_review_notes` · `appstore_list_builds` ·
  `appstore_list_beta_groups` · `appstore_get_app_info` · `appstore_list_app_info_localizations` ·
  `appstore_list_reviews` · `appstore_list_products` · `appstore_list_product_localizations` ·
  `appstore_plan_release` · `appstore_list_review_submissions` · `appstore_release_status` ·
  `appstore_get_age_rating` · `appstore_get_availability` · `appstore_beta_status` · `appstore_list_previews`
- **W** `appstore_upload_preview` (제품 페이지 미리보기 동영상 — 커밋 후 Apple 인코딩 남음) ·
- **W** TestFlight: `appstore_update_beta_review_detail` · `appstore_update_beta_test_info` ·
  `appstore_update_whats_to_test` · `appstore_add_beta_testers` (초대 발송) ·
  `appstore_notify_beta_testers` (테스터 전원 알림) ·
- **W** `appstore_update_age_rating` (심사 제출 전 필수) · `appstore_declare_encryption` (수출 규정 신고) ·
  `appstore_set_territory_availability` (지역 판매 on/off — confirm 게이트) ·
  `appstore_create_version` · `appstore_attach_build` · `appstore_attach_latest_build` ·
  `appstore_update_localization` · `appstore_upload_screenshot` · `appstore_update_whats_new` ·
  `appstore_update_review_notes` · `appstore_update_app_info_localization` · `appstore_create_app_info_localization` ·
  `appstore_reply_review` (public) ·
  `appstore_create_inapp_purchase` · `appstore_create_subscription` · `appstore_update_product` ·
  `appstore_update_product_review_note` · `appstore_update_product_localization` ·
  `appstore_add_product_to_review` ·
  `appstore_upload_product_review_screenshot`
- **U** `appstore_update_version_string` · `appstore_add_version_to_review_submission` ·
  `appstore_update_release_type` (MANUAL / AFTER_APPROVAL / SCHEDULED 전환) ·
  `appstore_phased_release` (단계적 출시 — `enable`/`pause`/`resume`은 되돌릴 수 있음)
- **D** `appstore_delete_preview` (동영상·세트 삭제) ·
- **D** `appstore_submit_beta_review` (Apple 베타 심사 시작) ·
  `appstore_set_beta_group_build` (외부 그룹이면 실배포/회수) ·
  `appstore_submit_for_review` · `appstore_release_version` (즉시 공개) ·
  `appstore_phased_release` `action=complete|disable` (남은 사용자 전체 공개) ·
  `appstore_cancel_review` · `appstore_remove_review_submission_item` ·
  `appstore_delete_screenshot` · `appstore_delete_screenshot_set` · `appstore_delete_product`

## Firebase — `registers/firebase.ts` (20)

- Read: `firebase_list_projects` · `firebase_get_project` · `firebase_list_android_apps` ·
  `firebase_get_android_config` · `firebase_list_ios_apps` · `firebase_get_ios_config` ·
  `firebase_list_web_apps` · `firebase_get_web_config` · `firebase_list_enabled_services` ·
  `firebase_get_analytics_details`
- **W** `firebase_create_project` (new GCP project + addFirebase, polls 2 long-running operations) ·
  `firebase_create_android_app` · `firebase_create_ios_app` · `firebase_create_web_app` ·
  `firebase_enable_service` · `firebase_enable_common_services` · `firebase_link_analytics`
- **D** `firebase_delete_android_app` · `firebase_delete_ios_app` · `firebase_delete_web_app`

## Cloud & growth domains

| Domain (file) | Tools (W = write, D = destructive) |
|---|---|
| AdMob (`admob.ts`) | `admob_list_accounts` · `admob_list_apps` · `admob_list_ad_units` · `admob_get_today_earnings` · `admob_get_report` · **W** `admob_create_app` · **W** `admob_create_ad_unit` |
| IAM (`iam.ts`) | `iam_list_service_accounts` · `iam_list_keys` · **W** `iam_create_service_account` · **W** `iam_create_key` (sensitive — issues a private key) · **W** `iam_add_iam_policy_binding` |
| GCP Billing (`billing.ts`) | `gcp_get_billing_info` · `gcp_list_billing_projects` (공용 결제계정 판별) · `gcp_list_budgets` · **W** `gcp_create_budget` (알림만 — 지출 차단 아님) |
| BigQuery (`bigquery.ts`) | `bigquery_run_query` (can incur cost) · `bigquery_list_datasets` · `bigquery_list_tables` · `bigquery_get_table_schema` · `bigquery_auth_status` |
| GA4 (`ga4.ts`) | `ga4_list_account_summaries` · `ga4_list_properties` · `ga4_list_data_streams` · `ga4_run_report` · `ga4_plan_bigquery_link` · **W** `ga4_create_property` · **W** `ga4_create_data_stream` · **W** `ga4_create_bigquery_link` (confirm 필요, 기존 링크는 no-op) |
| Search Console (`gsc.ts`) | `gsc_list_sites` · `gsc_list_sitemaps` · `gsc_get_sitemap` · `gsc_inspect_url` · `gsc_search_analytics` · **W** `gsc_submit_sitemap` |
| Google Ads (`googleads.ts`) | `googleads_list_campaigns` · `googleads_get_campaign_report` · `googleads_get_uac_report` · `googleads_list_accessible_customers` · `googleads_config_status` · **W** `googleads_save_config` (local config) |
| Facebook (`facebook.ts`) | `facebook_list_pages` · `facebook_get_page` · `facebook_current_config` · **W** `facebook_save_config` · **W** `facebook_post_photo` (public) · **W** `facebook_post_multi_photo` (public) |
| Instagram (`instagram.ts`) | `instagram_get_account` · **W** `instagram_save_config` · **W** `instagram_post_image` (public) · **W** `instagram_post_carousel` (public) |
| Threads (`threads.ts`) — Meta Threads Graph API, **text-first** (IG 와 별개 계정·토큰) | `threads_get_account` · `threads_current_config` · **W** `threads_save_config` · **W** `threads_refresh_token` · **W** `threads_post` (public; text or image) · **W** `threads_post_video` (public; public video URL) · **W** `threads_post_carousel` (public; 2–20) |

## Build / CI / signing

| Domain (file) | Tools |
|---|---|
| CI (`ci.ts`) — **GitHub Actions / GitLab only** | `ci_list_workflows` · `ci_get_build_status` · `ci_list_recent_builds` · **W** `ci_save_config` · **W** `ci_trigger_build` · **D** `ci_cancel_build` |
| Jenkins (`jenkins.ts`) — **credentials + job definitions, no build trigger** | `jenkins_status` · `jenkins_list_credentials` · `jenkins_list_jobs` · `jenkins_get_job_config` · **W** `jenkins_save_config` · **W** `jenkins_create_credential` · **W** `jenkins_upload_keystore` · **W** `jenkins_create_job` · **W** `jenkins_update_job` · **D** `jenkins_delete_credential` |
| Android signing (`android.ts`) | `android_signing_setup` · **W** `android_generate_keystore` · **W** `jenkins_upload_playstore_sa` |

## Cross-cutting

| Domain (file) | Tools |
|---|---|
| Checks (`checks.ts`) | `playstore_check_submission_risks` · `appstore_check_submission_risks` · `screenshot_validate` · `release_status` |
| Auth (`auth.ts`) | `mimi_seed_status` · `mimi_seed_auth_start` · `mimi_seed_auth_status` · `mimi_seed_remote_sync_credentials` |
| AI (`ai.ts`) — needs `ANTHROPIC_API_KEY` | `generate_release_notes_from_commits` · `generate_review_reply` |

## Video production — `registers/video.ts` (14) · impl `video/*.ts`

- Research/read: `youtube_get_video_status` · `video_research_youtube` (metadata/reference-only) ·
  `video_search_stock_assets` · `video_job_status` · `video_validate`
- **W** `youtube_upload_video` (기본 private, public/unlisted는 명시 확인 필수) ·
  `youtube_update_video_privacy` (public/unlisted는 명시 확인 필수)
- **W** `video_plan_from_story` (Anthropic + local project) · `video_synthesize_research` (metadata/user notes →
  bounded brief) · `video_download_stock_assets` (Pexels, preview then
  confirm) · `video_generate_image` (OpenAI, preview then confirm) · `video_add_local_asset` ·
  `video_build_timeline` · `video_render` (local FFmpeg job, preview then confirm)
- YouTube results are permanently marked `reference-only`; only assets with recorded provenance and
  `allowedForRendering=true` can enter a timeline.

## TikTok Business — `registers/tiktok.ts` (7) · impl `tiktok-business/*.ts`

- Read: `tiktok_business_auth_status` · `tiktok_business_get_account` ·
  `tiktok_business_get_video_settings` · `tiktok_business_list_publish_audits`
- **W** `tiktok_business_plan_video_post` (local validation plan + SHA-256 dedup record) ·
  `tiktok_business_get_publish_status` (provider read + local audit update)
- **W** `tiktok_business_publish_video` (owned Business Account에 공개 게시 — 명시 확인 필수,
  원자적 중복 예약, POST 결과 불명 시 자동 재시도 금지)

## Quirks worth knowing (tool name ≠ register file)

- **`checks.ts` owns the `*_check_submission_risks` and `release_status` tools**, not `playstore.ts` /
  `appstore.ts`. Search by the `server.tool('name'` string, not by the name prefix, when locating a tool.
- **`android.ts` registers `jenkins_upload_playstore_sa`** (a `jenkins_`-prefixed tool) because it is part of
  the Android signing setup flow.
- `setup_playstore_connection` lives in `playstore.ts` despite the un-prefixed name.

## Safety

The **D**-marked tools (submit/promote/cancel/delete) and public-post tools are near-irreversible or outward
facing. The runtime confirmation policy lives in [`../agent-guide.md`](../agent-guide.md) §5 and the
`mimi-seed://agent/guide` resource — do not restate it here; this catalog only flags which tools are sensitive.
