# Agent Guide — Driving Mimi Seed from an AI

> How an AI coding agent (Claude Code, Codex, Cursor, …) should call the Mimi Seed
> MCP tools correctly. If you are an agent and a user asks you to do app-store /
> Firebase / AdMob / CI work through `@yoonion/mimi-seed-mcp`, read this first.

The human-facing install + feature docs live in [`README.md`](../README.md). This file
is the **operational contract for agents**: how tools load, what order to call them in,
and which actions are irreversible.

---

## 0. The one thing that trips every agent: deferred tools

Mimi Seed exposes **110+ MCP tools**. Harnesses that lazy-load large tool catalogs —
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
| First contact / "what's connected?" | `select:mimi_seed_status,mimi_seed_auth_status,mimi_seed_auth_start` |
| Play Store release | `select:playstore_get_app,playstore_list_tracks,playstore_update_latest_release_notes,playstore_promote_release,playstore_submit_release,playstore_check_submission_risks,playstore_plan_release` |
| Play Store listing + images | `select:playstore_get_listing,playstore_update_listing,playstore_upload_image,playstore_list_images,playstore_replace_images,playstore_delete_all_images` |
| App Store / TestFlight | `select:appstore_list_apps,appstore_list_versions,appstore_create_version,appstore_get_metadata,appstore_update_whats_new,appstore_list_builds,appstore_attach_latest_build,appstore_submit_for_review,appstore_check_submission_risks,appstore_plan_release` |
| App Store screenshots | `select:appstore_list_app_info_localizations,appstore_get_metadata,appstore_list_screenshots,appstore_upload_screenshot,appstore_delete_screenshot_set,screenshot_validate` |
| Release notes from commits | `select:generate_release_notes_from_commits,playstore_update_release_notes,appstore_update_whats_new` |
| Firebase setup | `select:firebase_list_projects,firebase_get_project,firebase_create_android_app,firebase_create_ios_app,firebase_get_android_config,firebase_enable_common_services` |
| AdMob | `select:admob_list_accounts,admob_list_apps,admob_create_ad_unit,admob_list_ad_units,admob_get_today_earnings,admob_get_report` |
| Jenkins credentials | `select:jenkins_status,jenkins_save_config,jenkins_list_credentials,jenkins_create_credential,jenkins_upload_keystore,jenkins_upload_playstore_sa` |
| CI (GitHub/GitLab) | `select:ci_save_config,ci_list_workflows,ci_trigger_build,ci_get_build_status,ci_list_recent_builds` |
| Service account end-to-end | `select:iam_create_service_account,iam_create_key,iam_add_iam_policy_binding,playstore_register_service_account,playstore_verify_service_account` |

---

## 1. Always start with `mimi_seed_status`

Before any task, call **`mimi_seed_status`** — the setup doctor. It scans 9 services
(Google OAuth · Play SA · App Store · Jenkins · CI · Google Ads · Facebook · Instagram ·
BigQuery) and returns a ✅/❌ report plus the exact next tool to call for anything
missing. This avoids a late `401`/`403` deep into a workflow.

If auth is missing or expired:

| Service | Fix |
|---------|-----|
| Google (Firebase/AdMob/Play) | tool `mimi_seed_auth_start` → give the user the OAuth URL, **or** `npx -y @yoonion/mimi-seed-mcp mimi-seed-auth` |
| App Store Connect | `npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth` → verify with `appstore_verify_credentials` |
| Play service account | `npx -y @yoonion/mimi-seed-mcp mimi-seed-playstore-auth`, or register per-package with `playstore_register_service_account` |
| BigQuery | `npx -y @yoonion/mimi-seed-mcp mimi-seed-bigquery-auth` |

---

## 2. Auth & credential model

Credentials live under `~/.mimi-seed/` (legacy `~/.preseed/` is still read):

| File | Used for |
|------|----------|
| `tokens.json` | Google OAuth (Firebase, AdMob, Play Developer API, IAM, BigQuery) |
| `appstore.json` | App Store Connect API key (JWT) |
| `play-service-accounts/<packageName>.json` | **per-package** Play service account |
| `play-service-account.json` | default/legacy Play SA (fallback when no per-package match) |
| `jenkins.json`, `ci.json` | Jenkins / GitHub-GitLab CI connection |

Notes that matter in practice:

- **Per-package Play SA wins over the default.** Different apps can use SAs from
  different GCP projects. `playstore_list_service_accounts` shows the mapping.
- The Play SA's **GCP project must have the Android Publisher API enabled**, or every
  `playstore_*` call returns `403`.
- AI features (`generate_release_notes_from_commits`, `generate_review_reply`) need
  `ANTHROPIC_API_KEY` in the environment.

---

## 3. Tool catalog (by domain)

Full schemas load on demand via `ToolSearch`. Counts are approximate.

| Domain | Representative tools |
|--------|----------------------|
| **Google Play** (~26) | `playstore_get_app` · `playstore_get_listing` · `playstore_update_listing` · `playstore_list_tracks` · `playstore_update_latest_release_notes` · `playstore_promote_release` · `playstore_submit_release` · `playstore_upload_image` · `playstore_replace_images` · `playstore_check_submission_risks` · `playstore_get_statistics` · `playstore_reply_review` · `playstore_register_service_account` |
| **App Store Connect** (~30) | `appstore_list_apps` · `appstore_list_versions` · `appstore_create_version` · `appstore_update_whats_new` · `appstore_update_localization` · `appstore_list_builds` · `appstore_attach_latest_build` · `appstore_upload_screenshot` · `appstore_submit_for_review` · `appstore_cancel_review` · `appstore_list_beta_groups` · `appstore_reply_review` |
| **Firebase** (~17) | `firebase_create_android_app` · `firebase_create_ios_app` · `firebase_get_android_config` · `firebase_enable_service` · `firebase_enable_common_services` · `firebase_list_*_apps` |
| **AdMob** (7) | `admob_create_app` · `admob_create_ad_unit` · `admob_list_ad_units` · `admob_get_today_earnings` · `admob_get_report` |
| **CI/CD** (6) | `ci_trigger_build` · `ci_get_build_status` · `ci_list_workflows` (**GitHub Actions / GitLab only**) |
| **Jenkins** (credentials) | `jenkins_status` · `jenkins_save_config` · `jenkins_create_credential` · `jenkins_upload_keystore` · `jenkins_upload_playstore_sa` |
| **Google Cloud IAM** (5) | `iam_create_service_account` · `iam_create_key` · `iam_add_iam_policy_binding` |
| **BigQuery** (5) | `bigquery_run_query` · `bigquery_list_datasets` · `bigquery_get_table_schema` |
| **Search Console** (6) | `gsc_inspect_url` · `gsc_search_analytics` · `gsc_submit_sitemap` |
| **Facebook / Instagram** (10) | `facebook_post_photo` · `instagram_post_carousel` |
| **Checks** (4) | `playstore_check_submission_risks` · `appstore_check_submission_risks` · `screenshot_validate` · `release_status` |
| **AI / Auth** (4) | `generate_release_notes_from_commits` · `generate_review_reply` · `mimi_seed_status` · `mimi_seed_auth_status` |

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

> **Mimi Seed does not compile app binaries.** It manages metadata, store releases, and
> CI/Jenkins *credentials* — not Xcode/Gradle builds. To produce an `.ipa`/`.aab`, use
> EAS, Xcode, or a CI/Jenkins job. There is **no `jenkins_trigger_build` tool**; trigger
> a Jenkins job via its REST API and use the `jenkins_*` tools only for credentials.

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
- **Store-listing text vs images can route differently.** `playstore_upload_image`
  (icon/screenshots) and `playstore_update_listing` (description text) both need
  "Manage store presence", but may resolve credentials differently. If images upload
  but text returns `403`, it is a credential-routing issue, **not** the user's Play
  Console permissions — verify with a read (`playstore_get_listing`) and, if needed,
  fall back to entering text in Console.
- **`ci_*` is GitHub/GitLab only.** It does not trigger Jenkins builds.
- **Reward/cash-out apps** are a sensitive Play category — flag policy implications to
  the user, but it does not block test-track distribution.

---

## 7. Slash commands & MCP resources

Available in any MCP client as native slash commands:

- `/mimi-seed:deploy` — blockers → release notes → apply to stores
- `/mimi-seed:health` — auth status + readiness summary
- `/mimi-seed:review-inbox` — fetch unanswered reviews → draft replies

MCP resources: `mimi-seed://auth/status` (token state) · `mimi-seed://agent/guide`
(agent role definition).

---

_Keep this guide in sync with `README.md`'s tool list and the `skills/` directory._
