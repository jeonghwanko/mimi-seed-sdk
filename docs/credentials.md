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

<a id="what-you-need"></a>

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
| Upload / replace files in **Google Drive** | [Drive service account](#drive) for existing or shared folders; [Google OAuth](#google-oauth) for folders mimi-seed creates |
| Report on ad campaigns | [Google Ads](#google-ads) |
| Post launch announcements — `mimi-seed auth social` connects all of them in one pass | [YouTube](#google-oauth) (`youtube` profile) · [Facebook](#facebook) · [Instagram](#instagram) · [Threads](#threads) · [TikTok Business](#tiktok-business) |
| AI-written release notes / review replies | [`ANTHROPIC_API_KEY`](#anthropic-api-key) *(optional — it degrades gracefully)* |
| Research and produce a story-based video | [`ANTHROPIC_API_KEY`](#anthropic-api-key) + [video API keys](#video-api-keys) for only the providers you use |
| Use the hosted dashboard / remote MCP | [Mimi Seed account](#cloud-pat) |

**One Google login covers eight services.** Firebase, AdMob, Play, Google Ads, Search Console, GA4, Cloud IAM,
and BigQuery all ride on the same OAuth token. Start there.

---

<a id="google-oauth"></a>

## Google OAuth

**Unlocks:** `firebase_*`, `admob_*`, `playstore_*`, `googleads_*`, `gsc_*`, `ga4_*`, `iam_*`, `bigquery_*`, `youtube_*`, `drive_*` (requested with `--domains drive`; only files and folders mimi-seed creates)

For Search Console analysis, sign in with `mimi-seed auth login --domains gsc_readonly`. The existing `gsc` grant also covers reads and is required for sitemap submission. Use a named Google login profile to choose which account the GSC tools use.

**YouTube posting:** `mimi-seed auth social` (or `mimi-seed setup`) connects YouTube to a separate `youtube` Google profile, so the channel's account can differ from the one you use for Play and Firebase. It reuses the OAuth client from your default login. Pass `profile: "youtube"` to the `youtube_*` tools. To do it by hand: `mimi-seed auth login --profile youtube --domains youtube`.

YouTube Analytics reports use the separate `youtube_analytics` grant. Channel, video-list, and comment reads can use that grant or the existing publishing `youtube` grant; video management writes and comment replies use `youtube`.

For first sign-in, create a **Desktop app** OAuth client in Google Cloud and set `MIMI_SEED_GOOGLE_CLIENT_ID` and `MIMI_SEED_GOOGLE_CLIENT_SECRET` in the CLI or MCP server environment. A returning profile reuses its saved client, and a new named profile reuses the default login's client.

Your own client runs API calls against **its** Google Cloud project, so set that project up once:

1. **OAuth consent screen** — user type *External* (or *Internal* in a Workspace org), and add your own Google account under *Test users* while the app is in *Testing*.
2. **Enable the APIs** for the services you use (*APIs & Services → Library*): Firebase Management, AdMob, Google Play Android Developer, Google Play Developer Reporting, Search Console, Google Analytics Admin + Data, Identity and Access Management, BigQuery, YouTube Data, YouTube Analytics, Google Drive, Google Ads. A disabled API fails the first call with `SERVICE_DISABLED`; enable it and retry.
3. **Testing mode lasts a week.** Google expires refresh tokens of an *External* app in *Testing* after 7 days, so you would sign in again weekly. Publishing the app (*In production*) removes that limit; for your own use you can stay unverified and click through the warning.

```bash
mimi-seed auth login
```

A browser opens; approve; the token lands in `~/.mimi-seed/tokens.json`.

> ⚠️ **The one wall almost everyone hits.** If Google says *"access blocked"* / `access_denied` and you did not
> click deny: the OAuth app is in **testing** mode, so only registered test users may sign in. Add your Google
> account under *OAuth consent screen → Test users* of the client's project (yours, if you created the client),
> then retry. Retrying without that will never work. → [`troubleshooting.md#user-denied`](troubleshooting.md#user-denied)

**Verify:** `mimi-seed auth status`

[Troubleshoot OAuth client setup](troubleshooting.md#config-fetch-failed)

---

<a id="app-store-connect"></a>

## App Store Connect

**Unlocks:** `appstore_*` tools — versions, metadata, screenshots, TestFlight builds, review submission,
Analytics, and sales reports.

**You need first:** a **paid** Apple Developer Program membership. **App Manager** is enough for metadata and
release work, but creating Analytics report requests requires an **Admin** key. Sales reports require **Admin**,
**Finance**, or **Sales and Reports** access.

**Get it:**

1. App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API**
2. Generate an API key (Access: *Admin* for the complete feature set)
3. Collect three things: **Issuer ID**, **Key ID**, and the **`.p8` file**

> ⚠️ **The `.p8` downloads exactly once.** Apple will not let you download it again. If you lose it, revoke the
> key and issue a new one. Store it somewhere you'll still have next quarter.

**Give it to the wizard:** Issuer ID, Key ID, the path to the `.p8` on disk, and optionally the **Vendor Number**.
Open **Reports** at the top of App Store Connect; the Vendor Number appears at the upper left under the Legal
Entity Name. Enter digits only. Leaving it blank preserves
the saved value. When already connected, enter `v` at the API Key prompt to update only the Vendor Number without
re-entering the key;
reconnecting also preserves a separately configured reports key and Vendor Number.

**Verify:** `mimi-seed doctor`, or ask your agent for `appstore_verify_credentials`. The base check verifies app
listing access; role-specific Analytics and sales access is confirmed by the first read in that workflow.

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

<a id="drive"></a>

## Google Drive

**Unlocks:** `drive_*` — create folders, upload files, replace file contents in place, rename / move, trash.

**Two ways in — pick by where the files go:**

- **Folders mimi-seed creates** → your Google OAuth token is enough. Add the grant with
  `mimi-seed-auth --domains drive` (non-sensitive `drive.file` scope — it can only see files and folders this app
  created).
- **An existing folder or a shared drive** (a team folder, CI, cloud containers) → a Drive service account.

**Get the service account:**

1. Google Cloud Console → **APIs & Services** → enable the **Google Drive API**
2. **IAM & Admin** → **Service Accounts** → **Keys** → *Add key* → **JSON**
3. Share the target folder (or shared drive) with the service-account email as **Editor** **yourself**.
   Service accounts have no storage quota of their own — upload into a shared drive or a folder shared with them.
4. `mimi-seed auth drive` → give it the JSON path (non-interactive: `--file <json> --folder <folderId>`)

Where a file can't live (CI, cloud sandboxes), put the key JSON **body** in the `MIMI_SEED_DRIVE_SA_JSON`
environment variable instead — it wins over the saved file. Keep it in your platform's secret store.

**Verify:** ask for `drive_auth_status`.

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

**Browser login with your own Meta app (recommended, no server):** run `mimi-seed auth instagram`. The
first time, the wizard asks for your app's **Instagram app ID and app secret** and the redirect URI you
registered. They are saved to `~/.mimi-seed/meta-apps.json` (`0600`) only after a login succeeds, and they are
never sent anywhere except Instagram's token endpoint. Set the app up once:

1. [developers.facebook.com](https://developers.facebook.com/apps) → your app → use case *Manage messaging &
   content on Instagram* → *API setup with Instagram login*.
2. *Set up Instagram business login* → add a redirect URI to *OAuth redirect URIs*. The wizard suggests
   `https://localhost:8765/callback`.
3. Copy the **Instagram app ID / app secret** shown there. They differ from the Meta app ID.
4. While the app is in development mode, add your account under *App roles → Instagram Testers* and accept the
   invite in Instagram. Posting to your own accounts this way needs no App Review.

After you approve, the browser lands on the redirect URI. With an `https://` redirect the page usually fails to load;
that is expected. Paste the full address-bar URL into the terminal. The CLI checks that it is this login's redirect
(`state`), exchanges the code for a long-lived token, verifies the account, and saves it with the real expiry. If you
registered `http://localhost:<port>/<path>` instead, the CLI catches the redirect itself and there is nothing to
paste. A failed login keeps the existing connection. Use `--reset-app` to enter different app settings.

**Team broker:** if `MIMI_SEED_WEB_BASE` points to an operator-managed HTTPS broker, that broker is used instead
and holds the app secret. The SDK does not deploy it.

**Manual token:** `--manual-token`, or leaving the app ID blank, switches to pasting a token yourself.

**Unlocks:** `instagram_*` — posting images and carousels.

**Get it:** a long-lived access token, in either of two shapes (auto-detected):

- **`IGAA…`** — *Instagram API with Instagram Login*. The newer Meta path; **no Facebook Page required**.
- **`EAA…`** — *Instagram Graph API via Facebook Login*. Requires an Instagram **Business** account linked to a
  Facebook Page.

If you don't already have a Facebook Page in the mix, take the `IGAA…` path — it's fewer moving parts.

Tokens last about 60 days.

**Give it to the wizard:** just the token; the account ID is resolved for you. Verified before saving.

**Multiple accounts:** save a named account with `mimi-seed auth instagram --profile <id>`. Map a project to it
with `.mimi-seed.json` → `socialProfiles.instagram`. Named Instagram and Threads credentials share
`~/.mimi-seed/social-profiles/<id>.json` but remain separate platform entries.

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

1. Run `mimi-seed auth threads`. With your own Meta app (recommended, no server), the first run asks for the
   **Threads app ID and app secret** and your registered redirect URI. They are saved to `~/.mimi-seed/meta-apps.json`
   (`0600`) only after a login succeeds.
2. Set the app up once: [developers.facebook.com](https://developers.facebook.com/apps) → your app → use case
   *Access the Threads API* (`threads_basic`, `threads_content_publish`) → settings → add the redirect URI (the
   wizard suggests `https://localhost:8765/callback`) to *Redirect Callback URLs*. Meta will not save the form
   until the *Uninstall* and *Delete* callback URLs are filled in too. While the app is in development mode, add
   your account as a *Threads Tester* and accept the invite under threads.net → Settings → Website permissions.
3. Approve in the browser, then paste the address-bar URL of the page it lands on. The page failing to load is
   expected. With an `http://localhost:<port>/<path>` redirect the CLI catches it automatically. The CLI checks
   `state`, exchanges the code for a long-lived token, verifies the account, and saves it with the real expiry.
   `--reset-app` enters different app settings.

**Team broker:** if `MIMI_SEED_WEB_BASE` points to an operator-managed HTTPS broker, it is used instead and holds the
Threads app secret. The SDK does not deploy it.

**Advanced/manual flow:** `mimi-seed auth threads --manual-token` (or leaving the app ID blank) keeps the token-paste
path for headless use. The account is verified before saving. Use `--profile <id>` in any flow to save a named
account; the project can select it with `.mimi-seed.json` → `socialProfiles.threads`.

**Multiple accounts:** the project mapping is used automatically by Threads tools.

**Expiring token:** run `mimi-seed auth threads` or `threads_refresh_token`. While the current long-lived token
is still valid, Mimi Seed uses Threads' official refresh endpoint and stores the returned expiry. If refresh cannot
recover an expired or revoked token, the CLI falls back to the browser flow; use `--manual-token` only when you need
to provide a replacement directly. `mimi-seed setup` automatically flags tokens with seven days or less remaining.

Notes that bite: image/carousel URLs must be **public** (Graph API can't take local files), each post is capped
at **500 characters**, and image posts wait for Meta to process the media before publishing (a few seconds).

**Verify:** ask for `threads_get_account`.

---

<a id="tiktok-business"></a>

## TikTok Business

**Unlocks:** `tiktok_business_*` — preflight and publish a public video to an owned Business Account through
TikTok API for Business Organic API, then reconcile status and keep a local deduplication audit.

**Get it:** create an app in TikTok for Business Developer Portal, obtain Organic API approval, enable
**TikTok Accounts > Business Content > Video Publish**, and configure the TikTok account-holder redirect URL.
Authorize the owned account and copy the single-use `auth_code` from the callback URL within 10 minutes.

**Give it to the wizard:** run `mimi-seed auth tiktok`. It exchanges the code for a one-day access token plus a
one-year refresh token, verifies `/business/get/`, and writes `~/.mimi-seed/tiktok-business.json` as `0600`.
Access tokens refresh automatically five minutes before expiry; an expired/revoked refresh token needs a new code.

**Posting constraint:** Organic API accepts a `video_url`, not a local upload stream. The URL must be HTTPS,
belong to a domain verified for the app, return the video directly without a 3xx redirect, and remain available
while TikTok fetches it (30 minutes recommended).
Mimi Seed still requires the matching local source file for ffprobe validation and SHA-256 duplicate blocking.

**Verify:** ask for `tiktok_business_auth_status`, then `tiktok_business_get_account`.

For the complete app review, permission, Redirect URI, one-time `auth_code`, and video URL-property workflow,
follow [Set up TikTok Business Organic API](tiktok-business-setup.md).

---

<a id="cloud-pat"></a>

## Mimi Seed account (cloud)

**Unlocks:** the hosted dashboard and the remote MCP (a read/diagnostic subset).

For a team-operated console, set `MIMI_SEED_WEB_BASE` to its URL and run `mimi-seed init`. In CI, set both the console URL and `MIMI_SEED_TOKEN`.

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

<a id="video-api-keys"></a>

## Video API keys and FFmpeg

**Unlocks:** YouTube reference metadata (`video_research_youtube`), Pexels stock search
(`video_search_stock_assets`), and OpenAI scene-image generation (`video_generate_image`). Each capability is
optional; local/user-owned assets and FFmpeg rendering do not require these API keys.

Set only the providers you plan to use. Keys are read from the environment and are never stored in the project:

```bash
export YOUTUBE_API_KEY=<youtube-data-api-key>
export PEXELS_API_KEY=<pexels-api-key>
export OPENAI_API_KEY=<openai-api-key>
```

Rendering requires `ffmpeg` and `ffprobe` on `PATH`. If they live elsewhere, set
`MIMI_SEED_FFMPEG_PATH` and optionally `MIMI_SEED_FFPROBE_PATH` to their absolute executable paths.

---

<a id="android-keystore"></a>

## Android signing keystore

**Not an account** — a file you must produce, and the thing CI needs to sign a release build.

`android_signing_setup` prints a checklist; it does **not** create anything. `android_generate_keystore` can
create a `.jks` for you, but only if Java's **`keytool` is on your PATH** (install a JDK). Otherwise, generate
the keystore by hand.

A generated keystore and its passwords are saved as `0600` files under `~/.mimi-seed/keystores/<app>-<time>/`
(`upload.jks`, `signing.json`); the tool prints only their paths, never the passwords. **Back that folder up** —
losing it means losing the ability to sign updates.

Once you have it, upload it and its passwords into Jenkins with `jenkins_upload_keystore` and
`jenkins_create_credential`. For a generated keystore, pass the paths (`keystore_path`, and
`secret_file` + `secret_field`) instead of copying values into the chat.

Two steps stay irreducibly manual: the Play Console permission grant (see
[Play service account](#play-service-account)), and — for a brand-new app — uploading the **first** AAB to Play
Console by hand. The API cannot create an app that has never been published.

<a id="encrypt-stored-credentials"></a>

## Encrypting stored credentials (optional)

By default every file above is plaintext with mode `0600`: other users on the machine can't read it, but a copy of
your home folder (a backup, a synced folder, an old disk) can. To keep those files encrypted at rest:

```sh
mimi-seed credentials mode keychain   # or: auto — encrypt where a key store exists, plaintext elsewhere (CI, containers)
mimi-seed credentials encrypt         # encrypt the files that already exist
mimi-seed credentials status          # mode, key store, and each file's state
```

- The key lives in your OS key store: macOS Keychain, Windows DPAPI, or Linux Secret Service (needs
  `secret-tool` and a desktop session). `MIMI_SEED_CREDENTIAL_STORE` overrides the saved mode.
- Mimi Seed keeps working the same. Encrypted files are opened in memory when a tool needs them.
- **Over SSH (including VS Code Remote-SSH),** macOS keeps the login keychain locked in that session, separately
  from your desktop session, and can't show its unlock dialog. `mode` and `encrypt` offer to run
  `security unlock-keychain ~/Library/Keychains/login.keychain-db`, which asks for the keychain password (usually
  your login password). The unlock lasts only for that SSH session, so the next session sees locked files until
  you unlock again. On a machine you mostly use remotely, stay with `file`.
- **What it protects:** a copy of `~/.mimi-seed/` on its own reveals nothing. A full home-folder copy is only as
  safe as your login password, because the OS key store is protected by it. It does **not** protect against
  malware running as you.
- **If the key is lost** (the login keychain was reset, or you moved your home folder to another machine), the
  encrypted files can't be opened: `mimi-seed doctor` shows "cannot open encrypted file". Sign in to those
  services again.
- Once a machine has encrypted, it stays encrypted even if `settings.json` is lost. To go back:
  `mimi-seed credentials mode file`, then `mimi-seed credentials decrypt`.
- `keys/` and `keystores/` stay plaintext, because gcloud, Gradle, and CI read them directly.
- Every Mimi Seed install that reads this folder must be this version or newer. `mode` refuses while an MCP
  server registration is pinned to a version from before this feature. Register it with `@latest` instead. A
  globally installed `mimi-seed-mcp` can't be checked, so update it before turning encryption on.
