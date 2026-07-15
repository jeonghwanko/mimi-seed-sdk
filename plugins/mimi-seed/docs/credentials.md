# Connecting your accounts

For the complete journey from installation to deployment, start with the [Mimi Seed User Guide](user-guide/README.md).

**You should not read this front to back.** Run the wizard — it shows what's missing, connects what it can, and
sends you here only for the one credential you're stuck on:

```bash
mimi-seed setup
```

At each step, press `?` to see how to obtain that token. This page is the long version of those answers: the
parts that happen in *someone else's console*, which the wizard can walk you to but cannot do for you.

> Where each file lands on disk, and which code reads it, is a separate concern —
> see [`domain/auth-credentials.md`](domain/auth-credentials.md). Errors are in
> [`troubleshooting.md`](troubleshooting.md).

---

## What do you actually need?

Most people need two or three of these. Find your goal, connect only what it lists.

| I want to… | Credentials |
|---|---|
| Manage Firebase, AdMob, GA4, Search Console | [Google OAuth](#google-oauth) |
| Push release notes / listings / screenshots to **Google Play** | [Google OAuth](#google-oauth) |
| Run Play releases from **CI** (no browser) | [Google OAuth](#google-oauth) + [Play service account](#play-service-account) |
| Anything on the **App Store** (metadata, TestFlight, review) | [App Store Connect](#app-store-connect) |
| Trigger builds | [GitHub / GitLab](#ci-github-gitlab) *or* [Jenkins](#jenkins) |
| Query Crashlytics / analytics exports | [Google OAuth](#google-oauth), or [BigQuery SA](#bigquery) if OAuth keeps getting blocked |
| Report on ad campaigns | [Google Ads](#google-ads) |
| Post launch announcements | [Facebook](#facebook) · [Instagram](#instagram) · [Threads](#threads) |
| AI-written release notes / review replies | [`ANTHROPIC_API_KEY`](#anthropic-api-key) *(optional — it degrades gracefully)* |
| Use the hosted dashboard / remote MCP | [Mimi Seed account](#cloud-pat) |

**One Google login covers eight services.** Firebase, AdMob, Play, Google Ads, Search Console, GA4, Cloud IAM,
and BigQuery all ride on the same OAuth token. Start there.

---

<a id="google-oauth"></a>

## Google OAuth

**Unlocks:** `firebase_*`, `admob_*`, `playstore_*`, `googleads_*`, `gsc_*`, `ga4_*`, `iam_*`, `bigquery_*`

**You need first:** a Google account. That's all.

**Get it:** nothing to fetch. You do **not** create a Google Cloud project or an OAuth client — the client is
supplied for you at login time. Just run the wizard, or:

```bash
mimi-seed auth login
```

A browser opens; approve; the token lands in `~/.mimi-seed/tokens.json`.

> ⚠️ **The one wall almost everyone hits.** If Google says *"access blocked"* / `access_denied` and you did not
> click deny: the OAuth app is in **testing** mode, so only registered test users may sign in. Ask whoever
> operates the app to add your Google account under *OAuth consent screen → Test users*, then retry. Retrying
> without that will never work. → [`troubleshooting.md#user-denied`](troubleshooting.md#user-denied)

**Verify:** `mimi-seed auth status`

**Air-gapped or self-hosting?** The OAuth client id/secret is fetched at login from the Mimi Seed web console.
If you can't reach it, bring your own client via `MIMI_SEED_GOOGLE_CLIENT_ID` / `MIMI_SEED_GOOGLE_CLIENT_SECRET`
(loopback redirect on port 9876). → [`troubleshooting.md#config-fetch-failed`](troubleshooting.md#config-fetch-failed)

---

<a id="app-store-connect"></a>

## App Store Connect

**Unlocks:** every `appstore_*` tool — versions, metadata, screenshots, TestFlight builds, review submission.

**You need first:** a **paid** Apple Developer Program membership, and **Admin** or **App Manager** role on the
team.

**Get it:**

1. App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API**
2. Generate an API key (Access: *Admin* or *App Manager*)
3. Collect three things: **Issuer ID**, **Key ID**, and the **`.p8` file**

> ⚠️ **The `.p8` downloads exactly once.** Apple will not let you download it again. If you lose it, revoke the
> key and issue a new one. Store it somewhere you'll still have next quarter.

**Give it to the wizard:** Issuer ID, Key ID, then the path to the `.p8` on disk.

**Verify:** `mimi-seed doctor`, or ask your agent for `appstore_verify_credentials`.

---

<a id="play-service-account"></a>

## Play service account

**Unlocks:** `playstore_*` from a headless environment (CI).

**You probably don't need this.** Your Google OAuth login already carries the `androidpublisher` scope, so
local Play work — release notes, listings, tracks, screenshots — works without any service account. Add one
only when there is no browser: CI, a server, a cron job.

**Get it — the easy way:** ask your agent to run `setup_playstore_connection(packageName=…, projectId=…)`. It
creates the service account, issues the key, and registers it, using the Google login you already have.

**Get it — by hand:**

1. Google Cloud Console → **IAM & Admin** → **Service Accounts** → create one
2. **Keys** → *Add key* → *Create new key* → **JSON** → download
3. Run `mimi-seed auth playstore` and give it the JSON path

**Then, either way — the manual step nothing can automate:**

4. Play Console → **Users and permissions** → invite the service account's email address, grant release
   permissions
5. **Wait ~5 minutes.** Until the grant propagates, every call returns `403`. That is expected, not a bug.

Also make sure the **Android Publisher API is enabled** on the service account's GCP project — if it isn't,
*every* `playstore_*` call fails with `403`, and it looks exactly like a permissions problem but isn't.
→ [`troubleshooting.md#403-but-permissions-look-fine`](troubleshooting.md#403-but-permissions-look-fine)

**Verify:** ask for `playstore_verify_service_account`.

---

<a id="bigquery"></a>

## BigQuery

**Unlocks:** `bigquery_*` — Crashlytics exports, GA4 raw events.

**You may not need this.** BigQuery works on your Google OAuth token. A dedicated service account matters in one
case: Google **Workspace reauth policy** (`invalid_rapt`) keeps killing your OAuth token. Service-account auth is
exempt from that policy.

**Get it:**

1. Google Cloud Console → **IAM & Admin** → **Service Accounts** → **Keys** → *Add key* → **JSON**
2. Grant that service account two roles **yourself** — nothing does it for you:
   - `roles/bigquery.jobUser` (run queries)
   - `roles/bigquery.dataViewer` (read datasets)
3. `mimi-seed auth bigquery` → give it the JSON path

The setup CLI offers a live connection test and, if it fails, prints the exact `gcloud` commands to grant the
roles.

**Verify:** ask for `bigquery_auth_status`.

---

<a id="ci-github-gitlab"></a>

## CI — GitHub Actions / GitLab

**Unlocks:** `ci_*` tools and `mimi-seed deploy`'s build step.

**Get it (GitHub):** Settings → Developer settings → **Personal access tokens**.

> ⚠️ Check **both `repo` and `workflow`** scopes. With `repo` alone, reading works and dispatching a workflow
> fails with `403` — a confusing failure that shows up only at deploy time. The wizard checks the token's
> scopes before saving, so it catches this for you.

**Get it (GitLab):** User settings → **Access tokens** → scope `api` (a `glpat-…` token).

**Give it to the wizard:** token, owner/namespace, repo name; plus the host URL if you're on GitHub Enterprise
or self-hosted GitLab.

**Verify:** `mimi-seed doctor`.

---

<a id="jenkins"></a>

## Jenkins

**Unlocks:** `jenkins_*` (credentials + job definitions) and Jenkins builds from `mimi-seed deploy`.

**You need first:** an account on a Jenkins server. It doesn't have to be local — a company or remote URL is
fine.

**Get it:** Jenkins → **[your name]** → **Configure** → **API Token** → *Add new Token*.

That is an **API token**, not your password.

**Give it to the wizard:** URL, username, API token, and optionally the Android/iOS job names that
`mimi-seed deploy` should trigger. The wizard probes the server before saving, so a bad URL or token fails here
rather than mid-deploy.

**Verify:** `mimi-seed doctor`, or ask for `jenkins_status`.

---

<a id="google-ads"></a>

## Google Ads

**Unlocks:** `googleads_*` — campaign and UAC reporting.

**You need first:** a Google Ads account, and a **developer token**.

**Get it:**

1. Google Ads → **Tools and settings** → **Setup** → **API Center** → apply for a developer token
2. Note your **Customer ID** (`123-456-7890`), and the manager (MCC) account ID if you use one

> ⚠️ **The developer token is not instant.** The token you get immediately is *test* tier and only reaches test
> accounts. Reaching real campaign data requires Google to **approve** your application, which takes time. Plan
> for it.

Authentication itself rides on your Google OAuth token's `adwords` scope. If you logged in before that scope
existed, you'll need `mimi-seed auth login --force`. The setup CLI detects this and tells you.

**Verify:** ask for `googleads_config_status`.

---

<a id="facebook"></a>

## Facebook

**Unlocks:** `facebook_*` — posting launch announcements to a Page.

**You need first:** a Meta developer app, and **admin** rights on the Page you want to post to.

**Get it:**

1. Graph API Explorer → request permissions `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`
2. Generate a **User** token → call `/me/accounts`
3. Copy the **Page Access Token** (`EAA…`) from the page you want. Prefer a long-lived one (~60 days).

**Give it to the wizard:** just the token. The Page ID is resolved automatically; if the token can reach several
Pages, you'll be asked which one.

The token is verified against the live API **before** it is saved — an invalid token is never written to disk.

**Expired token:** run `mimi-seed auth facebook`. `mimi-seed setup` also flags an expired token (or one with
seven days or less remaining) and offers to reconnect it.

**Verify:** ask for `facebook_current_config`.

---

<a id="instagram"></a>

## Instagram

**Unlocks:** `instagram_*` — posting images and carousels.

**Get it:** a long-lived access token, in either of two shapes (auto-detected):

- **`IGAA…`** — *Instagram API with Instagram Login*. The newer Meta path; **no Facebook Page required**.
- **`EAA…`** — *Instagram Graph API via Facebook Login*. Requires an Instagram **Business** account linked to a
  Facebook Page.

If you don't already have a Facebook Page in the mix, take the `IGAA…` path — it's fewer moving parts.

Tokens last about 60 days.

**Give it to the wizard:** just the token; the account ID is resolved for you. Verified before saving.

**Expired token:** run `mimi-seed auth instagram`. `mimi-seed setup` also flags an expired token (or one with
seven days or less remaining) and offers to reconnect it.

**Verify:** ask for `instagram_get_account`.

---

<a id="threads"></a>

## Threads

**Unlocks:** `threads_*` — posting to Threads. **Text-first**: `threads_post` publishes a text post, or an image
if you pass one; `threads_post_carousel` does 2–20 images.

**A separate account and token from Instagram.** Threads has its own Graph API (`graph.threads.net`) and its own
token — an Instagram token will not work here.

**Get it:**

1. developers.facebook.com → your app → add the **Threads API** use case
2. Permissions: **`threads_basic`, `threads_content_publish`**
3. Authorize with Threads login, then exchange the short-lived token for a **long-lived** one (~60 days)

**Give it to the wizard:** just the token; the user ID is resolved for you. Verified before saving.

**Expiring token:** run `mimi-seed auth threads` or `threads_refresh_token`. While the current long-lived token
is still valid, Mimi Seed uses Threads' official refresh endpoint and stores the returned expiry. `mimi-seed
setup` automatically flags tokens with seven days or less remaining. An already expired or revoked token cannot
be refreshed; the same CLI flow falls back to asking for a newly issued token.

Notes that bite: image/carousel URLs must be **public** (Graph API can't take local files), each post is capped
at **500 characters**, and image posts wait for Meta to process the media before publishing (a few seconds).

**Verify:** ask for `threads_get_account`.

---

<a id="cloud-pat"></a>

## Mimi Seed account (cloud)

**Unlocks:** the hosted dashboard and the remote MCP (a read/diagnostic subset).

**Get it:** run `mimi-seed init`. It opens the browser, you sign in, and the token comes back automatically. In
CI, set `MIMI_SEED_TOKEN` instead and `init` skips the browser entirely.

**Verify:** `mimi-seed status`.

---

<a id="anthropic-api-key"></a>

## `ANTHROPIC_API_KEY`

**Unlocks:** AI-drafted release notes (`generate_release_notes_from_commits`) and review replies.

**Optional.** Without it, `mimi-seed notes` still works — it just formats your commits instead of writing prose.

**Get it:** Anthropic Console → **API Keys**.

**Give it to the wizard:** you don't. It's read from the environment only; there is no setup command.

```bash
export ANTHROPIC_API_KEY=sk-ant-...        # bash / zsh
$env:ANTHROPIC_API_KEY = "sk-ant-..."      # PowerShell
```

---

<a id="android-keystore"></a>

## Android signing keystore

**Not an account** — a file you must produce, and the thing CI needs to sign a release build.

`android_signing_setup` prints a checklist; it does **not** create anything. `android_generate_keystore` can
create a `.jks` for you, but only if Java's **`keytool` is on your PATH** (install a JDK). Otherwise, generate
the keystore by hand.

Once you have it, upload it and its passwords into Jenkins with `jenkins_upload_keystore` and
`jenkins_create_credential`.

Two steps stay irreducibly manual: the Play Console permission grant (see
[Play service account](#play-service-account)), and — for a brand-new app — uploading the **first** AAB to Play
Console by hand. The API cannot create an app that has never been published.
