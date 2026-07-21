# Tool catalog — 179 tools across 19 domains

> The MCP server's "entities". One row per domain → register file → tools, with **W** (write) and **D**
> (destructive / near-irreversible) markers. Everything unmarked is read-only.
>
> SSOT: `packages/mcp-server/tool-manifest.json` (test-enforced against the live `server.tool(…)`
> registrations — see [[pitfalls]] §8). Update the manifest and this catalog together when tools change.
> For *how to call* these in order, see [`../agent-guide.md`](../agent-guide.md); this doc is the inventory only.

## Counts by domain

| Domain | Register file | Tools |
|--------|---------------|------:|
| App Store Connect | `registers/appstore.ts` | 36 |
| Google Play | `registers/playstore.ts` | 29 |
| Firebase | `registers/firebase.ts` | 20 |
| AdMob | `registers/admob.ts` | 7 |
| CI (GitHub/GitLab) | `registers/ci.ts` | 6 |
| Jenkins (credentials + jobs) | `registers/jenkins.ts` | 10 |
| GA4 | `registers/ga4.ts` | 6 |
| Search Console | `registers/gsc.ts` | 6 |
| Google Ads | `registers/googleads.ts` | 6 |
| Facebook | `registers/facebook.ts` | 6 |
| Google Cloud IAM | `registers/iam.ts` | 5 |
| BigQuery | `registers/bigquery.ts` | 5 |
| Threads | `registers/threads.ts` | 6 |
| Instagram | `registers/instagram.ts` | 4 |
| Checks | `registers/checks.ts` | 4 |
| Auth | `registers/auth.ts` | 4 |
| Android signing | `registers/android.ts` | 3 |
| AI | `registers/ai.ts` | 2 |
| Video production | `registers/video.ts` | 14 |
| **Total** | **19 modules** | **179** |

## Google Play — `registers/playstore.ts` (29) · impl `playstore/tools.ts`

- Read: `playstore_get_app` · `playstore_get_listing` · `playstore_list_tracks` · `playstore_get_statistics` ·
  `playstore_list_images` · `playstore_list_reviews` · `playstore_list_inapp_products` ·
  `playstore_list_subscriptions` · `playstore_list_products` · `playstore_list_service_accounts` ·
  `playstore_verify_service_account` · `playstore_plan_release`
- **W** `playstore_update_listing` · `playstore_update_details` (developer contact + default language —
  `edits.details.patch`, distinct from the store listing) · `playstore_upload_image` · `playstore_replace_images` ·
  `playstore_update_release_notes` · `playstore_update_latest_release_notes` · `playstore_reply_review` (public) ·
  `playstore_create_onetime_product` · `playstore_create_subscription` · `playstore_update_product` ·
  `playstore_register_service_account` · `setup_playstore_connection`
- **D** `playstore_submit_release` · `playstore_promote_release` · `playstore_delete_all_images` ·
  `playstore_delete_product` · `playstore_delete_service_account`

## App Store Connect — `registers/appstore.ts` (36) · impl `appstore/tools.ts`

- Read: `appstore_list_apps` · `appstore_verify_credentials` · `appstore_get_app` · `appstore_list_versions` ·
  `appstore_get_metadata` · `appstore_list_screenshots` · `appstore_get_review_notes` · `appstore_list_builds` ·
  `appstore_list_beta_groups` · `appstore_get_app_info` · `appstore_list_app_info_localizations` ·
  `appstore_list_reviews` · `appstore_list_products` · `appstore_list_product_localizations` ·
  `appstore_plan_release`
- **W** `appstore_create_version` · `appstore_attach_build` · `appstore_attach_latest_build` ·
  `appstore_update_localization` · `appstore_upload_screenshot` · `appstore_update_whats_new` ·
  `appstore_update_review_notes` · `appstore_update_app_info_localization` · `appstore_create_app_info_localization` ·
  `appstore_reply_review` (public) ·
  `appstore_create_inapp_purchase` · `appstore_create_subscription` · `appstore_update_product` ·
  `appstore_update_product_review_note` · `appstore_update_product_localization` ·
  `appstore_upload_product_review_screenshot`
- **D** `appstore_submit_for_review` · `appstore_cancel_review` · `appstore_delete_screenshot` ·
  `appstore_delete_screenshot_set` · `appstore_delete_product`

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
| BigQuery (`bigquery.ts`) | `bigquery_run_query` (can incur cost) · `bigquery_list_datasets` · `bigquery_list_tables` · `bigquery_get_table_schema` · `bigquery_auth_status` |
| GA4 (`ga4.ts`) | `ga4_list_account_summaries` · `ga4_list_properties` · `ga4_list_data_streams` · `ga4_run_report` · **W** `ga4_create_property` · **W** `ga4_create_data_stream` |
| Search Console (`gsc.ts`) | `gsc_list_sites` · `gsc_list_sitemaps` · `gsc_get_sitemap` · `gsc_inspect_url` · `gsc_search_analytics` · **W** `gsc_submit_sitemap` |
| Google Ads (`googleads.ts`) | `googleads_list_campaigns` · `googleads_get_campaign_report` · `googleads_get_uac_report` · `googleads_list_accessible_customers` · `googleads_config_status` · **W** `googleads_save_config` (local config) |
| Facebook (`facebook.ts`) | `facebook_list_pages` · `facebook_get_page` · `facebook_current_config` · **W** `facebook_save_config` · **W** `facebook_post_photo` (public) · **W** `facebook_post_multi_photo` (public) |
| Instagram (`instagram.ts`) | `instagram_get_account` · **W** `instagram_save_config` · **W** `instagram_post_image` (public) · **W** `instagram_post_carousel` (public) |
| Threads (`threads.ts`) — Meta Threads Graph API, **text-first** (IG 와 별개 계정·토큰) | `threads_get_account` · `threads_current_config` · **W** `threads_save_config` · **W** `threads_refresh_token` · **W** `threads_post` (public; text or image) · **W** `threads_post_carousel` (public; 2–20) |

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
