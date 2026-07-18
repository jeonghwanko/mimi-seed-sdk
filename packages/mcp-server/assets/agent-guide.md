# Agent Guide — Driving Mimi Seed from an AI

> How an AI coding agent (Claude Code, Codex, Cursor, …) should call the Mimi Seed
> MCP tools correctly. If you are an agent and a user asks you to do app-store /
> Firebase / AdMob / CI work through `@yoonion/mimi-seed-mcp`, read this first.

The human-facing install + feature docs live in [`README.md`](../README.md). This file
is the **operational contract for agents**: how tools load, what order to call them in,
and which actions are irreversible.

> **Building or modifying the SDK itself?** The structural companion to this guide — architecture, the full tool
> catalog, the auth/credential model, and pitfalls — lives in the domain ontology under
> [`docs/domain/`](domain/_index.md). This guide is *how to call* the tools; the ontology is *how they're built*.

---

## 0. The one thing that trips every agent: deferred tools

Mimi Seed exposes **150+ MCP tools** across 19 domains (full inventory:
[`docs/domain/tool-catalog.md`](domain/tool-catalog.md)). Harnesses that lazy-load large tool catalogs —
**Claude Code most notably** — register these tools as **deferred**: the tool *names*
are visible (in a system reminder), but the **input schemas are not loaded**. If you
call a deferred tool directly, it fails with `InputValidationError` ("schema not
loaded"), and it is easy to wrongly conclude "this tool doesn't exist."

**Always load the schema before the first call.** In Claude Code:

```
ToolSearch(query="select:<tool_name>[,<tool_name>...]")
```

- Batch every tool you expect to use in one `select:` call — schemas stay loaded for
  the rest of the session.
- If `select:` returns no match, fall back to a keyword search
  (`ToolSearch(query="playstore release promote")`) — exact names sometimes differ.
- Only if a tool is absent from the deferred list **and** unsearchable is it truly
  unregistered. Then check the MCP server is connected (see §2), do **not** silently
  pivot to raw `curl` / `fastlane`.

Other harnesses (Codex with the bundled plugin, Claude Desktop) typically expose the
tools directly — but the *call order* and *safety rules* below still apply.

### Ready-made `select:` batches

| Goal | `ToolSearch` query |
|------|--------------------|
| First contact / "what's connected?" | `select:mimi_seed_status,mimi_seed_auth_status,mimi_seed_auth_start,mimi_seed_remote_sync_credentials` |
| Play Store release | `select:playstore_get_app,playstore_list_tracks,playstore_update_latest_release_notes,playstore_promote_release,playstore_submit_release,playstore_check_submission_risks,playstore_plan_release` |
| Play Store listing + images | `select:playstore_get_listing,playstore_update_listing,playstore_upload_image,playstore_list_images,playstore_replace_images,playstore_delete_all_images` |
| App Store / TestFlight | `select:appstore_list_apps,appstore_list_versions,appstore_create_version,appstore_get_metadata,appstore_update_whats_new,appstore_list_builds,appstore_attach_latest_build,appstore_submit_for_review,appstore_check_submission_risks,appstore_plan_release` |
| App Store screenshots | `select:appstore_list_app_info_localizations,appstore_get_metadata,appstore_list_screenshots,appstore_upload_screenshot,appstore_delete_screenshot_set,screenshot_validate` |
| App Store IAP review metadata | `select:appstore_list_apps,appstore_list_products,appstore_update_product_review_note,appstore_upload_product_review_screenshot` |
| Release notes from commits | `select:generate_release_notes_from_commits,playstore_update_release_notes,appstore_update_whats_new` |
| Firebase setup | `select:firebase_list_projects,firebase_get_project,firebase_create_project,firebase_create_android_app,firebase_create_ios_app,firebase_get_android_config,firebase_enable_common_services` |
| AdMob | `select:admob_list_accounts,admob_list_apps,admob_create_ad_unit,admob_list_ad_units,admob_get_today_earnings,admob_get_report` |
| Jenkins credentials + jobs | `select:jenkins_status,jenkins_save_config,jenkins_list_credentials,jenkins_create_credential,jenkins_upload_keystore,jenkins_upload_playstore_sa,jenkins_list_jobs,jenkins_get_job_config,jenkins_create_job,jenkins_update_job` |
| CI (GitHub/GitLab) | `select:ci_save_config,ci_list_workflows,ci_trigger_build,ci_get_build_status,ci_list_recent_builds` |
| Service account end-to-end | `select:iam_create_service_account,iam_create_key,iam_add_iam_policy_binding,playstore_register_service_account,playstore_verify_service_account` |
| Story → researched video | `select:video_plan_from_story,video_research_youtube,video_search_stock_assets,video_synthesize_research,video_download_stock_assets,video_generate_image,video_add_local_asset,video_build_timeline,video_render,video_job_status,video_validate` |
| YouTube upload / publish | `select:youtube_upload_video,youtube_get_video_status,youtube_update_video_privacy,mimi_seed_auth_start` |

---

## 1. Always start with `mimi_seed_status`

Before any task, call **`mimi_seed_status`** — the setup doctor. It scans your service
credentials (Google OAuth · Play SA · App Store · Jenkins · CI · Google Ads · Facebook · Instagram ·
Threads · BigQuery) and returns a ✅/❌ report plus the exact next tool to call for anything
missing. This avoids a late `401`/`403` deep into a workflow.

> If the repo has a **`.mimi-seed.json`** manifest at its root, `mimi_seed_status` (and
> `mimi-seed doctor`) additionally report **which project-required services this teammate is
> missing** + the precise fix command — use that section to onboard a new teammate.
> **BigQuery** can be satisfied per-machine (`mimi-seed-bigquery-auth`) **or** workspace-wide:
> a workspace admin registers a shared service account once and every member queries via the
> **Remote MCP** with no personal key (`register_integration(provider="bigquery", …)`).

If auth is missing or expired, the shortest path for a human is **`mimi-seed setup`** — one guided pass over
every credential, which also tells them where to obtain each token
([`credentials.md`](credentials.md)). Per-credential fixes:

| Service | Fix |
|---------|-----|
| Google (Firebase/AdMob/Play/Ads/GSC/GA4/IAM/BigQuery/YouTube) | tool `mimi_seed_auth_start` → give the user the OAuth URL, **or** `mimi-seed auth login`. Both accept a **domain subset** (`domains=["youtube"]` / `--domains youtube`) — request only what the task needs; re-auth keeps prior grants (incremental). Omit for all domains |
| App Store Connect | `mimi-seed auth appstore` → verify with `appstore_verify_credentials` |
| Play service account | `mimi-seed auth playstore`, or register per-package with `playstore_register_service_account`. **Optional** — the OAuth token carries `androidpublisher`, so this is only needed for headless/CI |
| BigQuery | `mimi-seed auth bigquery` (optional — OAuth works too) |
| Jenkins | `mimi-seed auth jenkins` (probes the server before saving) |
| GitHub / GitLab CI | `mimi-seed auth ci` |
| Google Ads | `mimi-seed auth googleads` — needs the `adwords` OAuth scope; an old token may need `mimi-seed auth login --domains googleads` (adds the grant, keeps the rest) |
| Facebook / Instagram / Threads | `mimi-seed auth facebook` / `mimi-seed auth instagram` / `mimi-seed auth threads` |

`mimi-seed auth meta` opens the combined social setup entry point when the user wants to review or reconnect
all three Meta platforms in one pass.

Each `mimi-seed auth <cred>` wraps the matching `npx -y @yoonion/mimi-seed-mcp mimi-seed-*-auth` binary, so
either form works.

For Facebook, Instagram, and Threads, `mimi-seed setup` reads the saved expiry estimate. Expired tokens and
tokens with seven days or less remaining are automatically put back into the setup plan. A live Meta rejection
(including OAuth code 190) returns the exact `mimi-seed auth <platform>` recovery command instead of a raw error.
For an unexpired Threads long-lived token, `threads_refresh_token` (also the default path in `mimi-seed auth
threads`) refreshes it without asking the user to paste a replacement. Expired or revoked tokens still require a
new authorization.

---

## 2. Auth & credential model

Credentials live under `~/.mimi-seed/` (legacy `~/.preseed/` is still read):

| File | Used for |
|------|----------|
| `tokens.json` | Google OAuth (Firebase, AdMob, Play Developer API, IAM, BigQuery) |
| `appstore.json` | App Store Connect API key (JWT) |
| `play-service-accounts/<packageName>.json` | **per-package** Play service account |
| `play-service-account.json` | default/legacy Play SA (fallback when no per-package match) |
| `bigquery-service-account.json` | BigQuery SA (exempt from Workspace reauth; OAuth is the fallback) |
| `jenkins.json`, `ci.json` | Jenkins / GitHub-GitLab CI connection |
| `google-ads.json` | Google Ads developer token + customer id |
| `facebook.json`, `instagram.json`, `threads.json` | Page / account access tokens for the social post tools (Threads is a separate Meta account/token) |

Notes that matter in practice:

- **Per-package Play SA wins over the default.** Different apps can use SAs from
  different GCP projects. `playstore_list_service_accounts` shows the mapping.
- The Play SA's **GCP project must have the Android Publisher API enabled**, or every
  `playstore_*` call returns `403`.
- AI features (`generate_release_notes_from_commits`, `generate_review_reply`) need
  `ANTHROPIC_API_KEY` in the environment.
- Video production uses capability-specific environment keys: `ANTHROPIC_API_KEY` (storyboard),
  `YOUTUBE_API_KEY` (reference research), `PEXELS_API_KEY` (licensed stock search), and
  `OPENAI_API_KEY` (generated images). Rendering needs FFmpeg on `PATH` or
  `MIMI_SEED_FFMPEG_PATH`.

---

## 3. Tool catalog (by domain)

Full schemas load on demand via `ToolSearch`. These are representative tools, not a full list — the exact
per-domain inventory is [`docs/domain/tool-catalog.md`](domain/tool-catalog.md).

| Domain | Representative tools |
|--------|----------------------|
| **Google Play** | `playstore_get_app` · `playstore_get_listing` · `playstore_update_listing` · `playstore_list_tracks` · `playstore_update_latest_release_notes` · `playstore_promote_release` · `playstore_submit_release` · `playstore_upload_image` · `playstore_replace_images` · `playstore_check_submission_risks` · `playstore_get_statistics` · `playstore_reply_review` · `playstore_register_service_account` |
| **App Store Connect** | `appstore_list_apps` · `appstore_list_versions` · `appstore_create_version` · `appstore_update_whats_new` · `appstore_update_localization` · `appstore_list_builds` · `appstore_attach_latest_build` · `appstore_upload_screenshot` · `appstore_submit_for_review` · `appstore_cancel_review` · `appstore_list_beta_groups` · `appstore_reply_review` |
| **Firebase** | `firebase_create_project` · `firebase_create_android_app` · `firebase_create_ios_app` · `firebase_get_android_config` · `firebase_enable_service` · `firebase_enable_common_services` · `firebase_list_*_apps` |
| **AdMob** | `admob_create_app` · `admob_create_ad_unit` · `admob_list_ad_units` · `admob_get_today_earnings` · `admob_get_report` |
| **CI/CD** | `ci_trigger_build` · `ci_get_build_status` · `ci_list_workflows` (**GitHub Actions / GitLab only**) |
| **Jenkins** (credentials + jobs) | `jenkins_status` · `jenkins_save_config` · `jenkins_create_credential` · `jenkins_upload_keystore` · `jenkins_upload_playstore_sa` · `jenkins_create_job` · `jenkins_update_job` |
| **Google Cloud IAM** | `iam_create_service_account` · `iam_create_key` · `iam_add_iam_policy_binding` |
| **BigQuery** | `bigquery_run_query` · `bigquery_list_datasets` · `bigquery_get_table_schema` |
| **Search Console** | `gsc_inspect_url` · `gsc_search_analytics` · `gsc_submit_sitemap` |
| **Facebook / Instagram / Threads** | `facebook_post_photo` · `instagram_post_carousel` · `threads_post` · `threads_refresh_token` |
| **Checks** | `playstore_check_submission_risks` · `appstore_check_submission_risks` · `screenshot_validate` · `release_status` |
| **AI / Auth** | `generate_release_notes_from_commits` · `generate_review_reply` · `mimi_seed_status` · `mimi_seed_auth_start` · `mimi_seed_auth_status` · `mimi_seed_remote_sync_credentials` |
| **Video production** | `youtube_upload_video` · `youtube_get_video_status` · `youtube_update_video_privacy` · `video_plan_from_story` · `video_research_youtube` · `video_search_stock_assets` · `video_synthesize_research` · `video_generate_image` · `video_build_timeline` · `video_render` · `video_job_status` · `video_validate` |

---

## 4. Workflows (call sequences)

### Play Store release / promote
1. `playstore_list_tracks` — see current track/version state.
2. `playstore_check_submission_risks` (or `playstore_plan_release`) — surface blockers.
3. Write missing listing/notes (`playstore_update_listing`, `playstore_update_latest_release_notes`, `playstore_upload_image`).
4. `playstore_promote_release` / `playstore_submit_release` — **confirm first** (see §5).

### App Store TestFlight → review
1. `appstore_list_apps` → `appstore_list_versions` (or `appstore_create_version`).
2. `appstore_list_builds` → `appstore_attach_latest_build` (only `processingState=VALID`).
3. `appstore_update_whats_new`, screenshots if needed.
4. `appstore_check_submission_risks` → `appstore_submit_for_review` — **confirm first**.

### Release notes from git
`generate_release_notes_from_commits` (pass commit array + locales) → review with user →
`playstore_update_release_notes` / `appstore_update_whats_new`.

### Story → researched video
1. `video_plan_from_story` — create the project and scene plan.
2. `video_research_youtube` — collect reference-only metadata; never treat a result as a render asset.
3. `video_search_stock_assets` — find licensed Pexels candidates.
4. `video_synthesize_research` — combine metadata with any direct human/agent observations. Treat its output as
   metadata-bounded guidance, not proof that the source videos were watched.
5. Preview then confirm `video_download_stock_assets`; use `video_generate_image(confirm=false)` before any paid
   generation and call it again with `confirm=true` only after approval. User-owned media goes through
   `video_add_local_asset` with its ownership/license basis.
6. `video_build_timeline` — provenance-gated scene assignment.
7. Preview then confirm `video_render`; poll `video_job_status`, then run `video_validate` on the completed MP4.

> **Mimi Seed does not compile app binaries.** It manages metadata, store releases, and
> CI/Jenkins *credentials and job definitions* — not Xcode/Gradle builds. To produce an
> `.ipa`/`.aab`, use EAS, Xcode, or a CI/Jenkins job. There is **no `jenkins_trigger_build`
> tool**; trigger a Jenkins job via its REST API and use the `jenkins_*` tools for
> credentials and job configs.

---

## 5. Safety — irreversible actions need explicit confirmation

Never run these without the user's go-ahead in the same turn:

| Action | Why |
|--------|-----|
| `playstore_submit_release` / `playstore_promote_release` with `status=completed` | Starts Google review / full rollout. Near-irreversible. |
| `appstore_submit_for_review` | Submits to Apple review. |
| `appstore_delete_screenshot_set`, `playstore_delete_all_images` | Deletes assets. |
| `playstore_delete_product`, `jenkins_delete_credential`, `firebase_delete_*_app` | Destructive. |

General rules:
- Run `*_check_submission_risks` / `*_plan_release` **before** submitting, and show
  blockers to the user as a checklist first.
- Pass file paths as **absolute paths**; never load image bytes into the conversation.
- Prefer `status=draft` while iterating; flip to `completed` only on explicit request.

---

## 6. Known gotchas (learned the hard way)

- **Draft-app track constraint (Play).** Until an app has its first non-internal
  publish, only the **`internal`** track can be `completed`. `alpha`/`beta`/`production`
  reject anything but `draft` → error: *"Only releases with status draft may be created
  on draft app."* Closed/open testing also needs the **App Content** declarations
  (content rating, data safety, target audience) which are **Console-only** — the API
  cannot set them.
- **A `403` on one write but not another is usually NOT a permissions gap.** Every
  `playstore_*` write resolves the same credential (`requirePlayStoreAuth`), so if
  `playstore_upload_image` succeeds but `playstore_update_listing` returns `403`, the
  account's permissions are fine. Read the **raw Google reason** surfaced in the error
  (app state, policy, or an operation-specific restriction) instead of blindly
  "granting permission" — the friendly 403 message now includes that reason.
- **Play edits overwrite un-published Console changes.** Committing *any* Play
  Developer API edit (image upload, listing update, release) discards listing/release
  changes you saved-but-didn't-publish in the Play Console UI. Google's own docs warn
  against editing the same app with both tools at once. Do all listing writes via the
  API, or finish & publish your Console edits first — never interleave them.
- **`ci_*` is GitHub/GitLab only.** It does not trigger Jenkins builds.
- **Reward/cash-out apps** are a sensitive Play category — flag policy implications to
  the user, but it does not block test-track distribution.

---

## 7. Slash commands & MCP resources

Available in any MCP client as native slash commands:

- `/mimi-seed:getting-started` — first-run onboarding: status scan → capability tour → first read-only action
- `/mimi-seed:deploy` — blockers → release notes → apply to stores
- `/mimi-seed:health` — auth status + readiness summary
- `/mimi-seed:review-inbox` — fetch unanswered reviews → draft replies

MCP resources: `mimi-seed://auth/status` (live token state) · `mimi-seed://agent/guide`
(this guide, served over MCP) · `mimi-seed://tools/catalog` (the full tool inventory by
domain, with the credential each domain needs — read it to answer "what can Mimi Seed do?").

---

_Keep this guide in sync with `README.md`'s tool list and the `skills/` directory._
