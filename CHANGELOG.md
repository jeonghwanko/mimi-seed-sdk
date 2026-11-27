# Changelog

All notable changes to the Mimi Seed SDK — the `mimi-seed` CLI and the `@yoonion/mimi-seed-mcp` MCP server — are
recorded here. Both packages ship under one version (the root `package.json`), so each release below covers both.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## How to write an entry

- Add every user-visible change to **`[Unreleased]`** in the same PR, under `Added` / `Changed` / `Deprecated` /
  `Removed` / `Fixed` / `Security`. Write for the person upgrading, not for the reviewer.
- **`Tool changes`** lists MCP tools that were **added**, **renamed** (`old_name` → `new_name`), or **removed**.
  A rename or removal breaks any agent prompt, skill, or `select:` batch that names the old tool, so it must
  never be only implied by a feature bullet. Write "none" when a release changes no tool names.
- At release time the maintainer renames `[Unreleased]` to `[x.y.z] - YYYY-MM-DD` (the version set by
  `npm run version:set`) and opens a fresh empty `[Unreleased]` above it.

## [Unreleased]

### Added

- `social_publish` posts one announcement to several platforms (Facebook, Instagram, Threads, YouTube, and TikTok) in a single call. Without `confirm` it returns a plan for each platform and lists anything that would block it. Nothing is posted anywhere unless every platform passes, and every platform's pre-send checks (sign-in and tokens, the YouTube channel and video file, the TikTok publish permission) run before anything is sent. After you approve, results come back per platform. The same post — the same platform, account, and content — is never posted twice: calling again skips the platforms that already posted and resends the ones that failed (fix a failed one through its own options, e.g. `threads.text`). To post the same content again on purpose, name the platform in `repost`. A call that overlaps another one publishing to the same account is refused until that one finishes. A platform whose outcome is unknown (the publishing request was sent but the answer was a server error, a timeout, or a dropped connection) is never resent automatically, and that account stays blocked even for edited content; after you check the platform, send again with `resendUnknown`. Failures before the publishing request, and clear refusals such as YouTube's upload quota, are reported as failed and can simply be sent again. The record is kept in `~/.mimi-seed/social-publish/`.
- A one-page **social setup checklist** ([`docs/user-guide/social-setup-checklist.md`](docs/user-guide/social-setup-checklist.md), Korean `.ko.md`). It covers what to prepare in each platform's console (YouTube, Facebook, Instagram, Threads, TikTok), the one command that connects them all (`mimi-seed auth social`), how to verify, what expires, and the usual blockers. `mimi-seed auth social` now points to it when it starts.

### Tool changes

- Added `social_publish` (new `crosspost` domain, included in the `social` toolset).

## [0.25.4] - 2026-11-27

### Added

- `mimi-seed auth instagram` and `mimi-seed auth threads` can sign in through the browser with **your own Meta app**, with no server in between. Since the public console was retired, these commands could only take a pasted token. The first run asks for the app ID, app secret, and registered redirect URI. They are saved to `~/.mimi-seed/meta-apps.json` (`0600`, and encrypted like your other credentials when credential encryption is on) only after a successful login. The app secret is not shown on screen as you type it. After you approve, paste the redirected URL, or register an `http://localhost:<port>` redirect and the CLI catches it. `--reset-app` changes the saved app. A team broker (`MIMI_SEED_WEB_BASE`), `--manual-token`, and a token piped on standard input (`printf 'IGAA…' | mimi-seed auth instagram`) work as before.
- `mimi-seed auth social` connects every posting channel (YouTube, Facebook, Instagram, Threads, and TikTok) in one pass. Anything already connected is skipped, and expired or expiring tokens are reconnected. Setup flags such as `--reconnect threads` pass through.
- YouTube upload now appears in `mimi-seed setup`, `mimi-seed doctor`, and `mimi-seed auth status --all`. Connecting it signs in to a separate `youtube` Google profile (`mimi-seed auth login --profile youtube --domains youtube`), so a channel owned by a different Google account never replaces your default login for Play and Firebase. It counts as connected when the default login or any named profile has the YouTube upload permission. Pass `profile: "youtube"` to the `youtube_*` tools.

### Changed

- The first sign-in of a new named Google profile reuses the OAuth client saved by your default login, so you no longer have to set `MIMI_SEED_GOOGLE_CLIENT_ID` / `MIMI_SEED_GOOGLE_CLIENT_SECRET` again.
- `mimi_seed_status` reports YouTube as connected when a named profile has the upload permission, and names the profile to pass. Before, it looked only at the default login.
- `jenkins_create_credential`, `jenkins_upload_keystore`, and `jenkins_upload_playstore_sa` now send nothing to Jenkins without `confirm: true`, including for a new credential id. The dry-run says whether the id will be created or replaced. Before, a new id was created on the first call, so a secret could leave your machine with no confirmation, and the replace path showed the approval dialog twice. Now it is shown once, when the upload actually happens.
- The Codex plugin marketplace, like the Claude Code one, now offers a release only after its server version is on npm. Installing or updating the plugin between a release merge and its npm publish no longer fails to start the server.

### Fixed

- `mimi-seed auth instagram` / `threads` with your own Meta app:
  - Cancelling consent now ends the login at once with "consent was cancelled". Before, a local redirect left it waiting 10 minutes, and a pasted URL was reported as the wrong address.
  - The app secret can no longer be recalled with ↑ at a later prompt.
  - Ctrl-C cancels with exit code 130 instead of finishing as a success.
  - The setup now says to enter the redirect URI exactly as the Meta dashboard saved it, including a trailing `/`.
- `MIMI_SEED_WEB_BASE`:
  - Must be the team console's root address. With a path (`https://console.example.com/team`), some commands dropped the path and sent your token to the root of the host. A bare `?` or `#` broke every endpoint.
  - When it is set but not accepted, every `mimi-seed` command now says why, instead of acting as if it were not set.
  - A local `http://localhost` console no longer blocks Instagram/Threads sign-in; it falls back to the local login.
- `mimi-seed telemetry`:
  - `telemetry on` without a team console now explains that one is needed and exits 1, instead of printing "disabled".
  - The "usage measurement is off" notice is no longer shown when there is no console to send it to.
  - A one-off `MIMI_SEED_TELEMETRY=1` against another console no longer resets your saved consent.
- A Google sign-in with no OAuth client configured is reported as not retriable, so agents ask you to set one up instead of retrying. The Google OAuth guide now covers what your own client's project needs: the consent screen, the APIs to enable, and the 7-day sign-in limit of *Testing* mode.

### Security

- The approval dialog also asks before `drive_upload_file` and `drive_update_file_metadata`, which can put a local file or move a folder into any Drive folder, and before `playstore_register_service_account`, which replaces a stored Play key. Drive uploads also refuse files inside `~/.mimi-seed/`.
- The approval dialog:
  - Shows hidden Unicode (tag characters, variation selectors, the Hangul filler) as escapes, so approved text cannot carry an invisible payload.
  - Redacts common CI secret names such as `API_KEY`, `SIGNING_KEY`, and `STORE_PASS`.
  - Treats a timed-out or interrupted dialog as unanswered rather than declined, so the call can be asked again right away.

### Tool changes

- none

## [0.25.3] - 2026-11-27

### Changed

- Initialize SDK projects locally without the retired public console. Google sign-in reuses stored OAuth clients, and remote workflows require a team console URL.

### Security

- Google login now binds the authorization code with PKCE (S256), on top of the existing `state` check. A code intercepted on the local callback (another process holding the port, a browser extension reading the redirect URL) can no longer be exchanged for a refresh token, because the matching verifier never leaves the process that started the login. Existing saved logins keep working; nothing to re-run.
- In clients that support approval dialogs (MCP elicitation), Mimi Seed now asks **you** before it runs a confirmed action, instead of trusting the agent's `confirm` alone. That covers releases, deletes, public posts, IAM changes and the other actions that need a confirm flag, plus every call that saves a connection setting (`*_save_config`), uploads a credential to Jenkins, or starts a CI workflow. The dialog shows the tool and its arguments (strings quoted, hidden characters made visible, long values shortened with a warning), and the action runs only if you tick *approve* and confirm. This closes the path where text the agent read (a review, a comment, a document) talks it into a release, an IAM key, or sending a credential somewhere else. A declined request returns a `⛔` result, changes nothing, and is refused without asking again for 5 minutes.
- `MIMI_SEED_APPROVAL` chooses what happens in clients without approval dialogs: `auto` (default) keeps the old behavior, `required` refuses, `off` never asks (unattended runs only). An unrecognized value now means `required`. `mimi_seed_status` shows the live mode on its `🛡️ Approval:` line.
- The Claude Code plugin now starts the server version it was released with, instead of `@latest`, and the marketplace offers a release only after that version is on npm. A new npm release therefore reaches plugin users through a plugin update. Registrations you made yourself with `claude mcp add … @latest` are unchanged.
- The published MCP server package ships an `npm-shrinkwrap.json`, so `npx` installs exactly the dependency versions CI tested, each checked against its registry hash, instead of the newest version in each range. Development tools are not included, and the install size does not change.

## [0.25.2] - 2026-11-27

### Changed

- The tool list the MCP server sends to the agent on every connection is about 8% smaller. Each tool's input schema no longer carries the `$schema` dialect URL, and tool annotations omit hints equal to the MCP defaults (`readOnlyHint: false`, `idempotentHint: false`, `openWorldHint: true`). `destructiveHint` is always stated. Tool names, schemas, and behavior are unchanged.

## [0.25.1] - 2026-11-27

### Fixed

- `mimi-seed credentials mode keychain` failed on macOS with an unexplained "security exited with status 36" when run over SSH, including VS Code's Remote-SSH terminal. macOS keeps the login keychain locked in an SSH session and can't show its unlock dialog there.
  - The error now says the keychain is locked in this remote session. It names `security unlock-keychain …` and `mode file`.
  - On a terminal, `mode` and `encrypt` offer to run that unlock and then try again.
  - `mode auto` now tries to create the key at once. If it can't, it says credentials stay plaintext for now.
  - Other keychain failures each get their own message: wrong keychain password, no keychain, a cancelled dialog, and a timed-out dialog.
  - Creating the key no longer waits on the keychain a second time after a refusal.
  - Both creating and reading the key now name the login keychain explicitly.

## [0.25.0] - 2026-11-27

### Added

- Optional encryption of stored credentials, off by default. Run `mimi-seed credentials mode keychain` (or `auto`, or set `MIMI_SEED_CREDENTIAL_STORE`), then `mimi-seed credentials encrypt`. Credential files under `~/.mimi-seed/` are then written encrypted with a key kept in the OS key store (macOS Keychain, Windows DPAPI, Linux Secret Service). In `keychain` mode, a save fails with the reason if the key store can't be reached. In `auto` mode, files stay plaintext where no key store exists, until the machine has encrypted once. `mimi-seed credentials status` shows the mode and each file's state, `decrypt` reverses it, and `mimi-seed doctor` / `mimi_seed_status` show the storage mode. Every Mimi Seed install that reads the same folder must be this version or newer, so turning encryption on is refused while an MCP server registration is pinned to an older version. See docs/credentials.md, "Encrypting stored credentials". If an encrypted file can't be opened on a machine (the key is missing or the key store can't be reached), every loader, `mimi-seed doctor` / `setup`, and `mimi_seed_status` say "cannot open encrypted file" and name the file and the reason, instead of "not set up" or "damaged".
- The `pdf-design-quality` skill guides readers through Korean font selection and embedding, page hierarchy, and desktop and mobile PDF render checks.
- English output from every tool: in English mode, the text each tool returns (store, Firebase, Jenkins, CI, video, social, and the rest) is English, along with the destructive-tool dry-run preview, Google / Google Play / App Store error explanations, store auth hints, `mimi_seed_status` and the other connection tools, remote credential sync, MCP prompts, and the `mimi-seed://tools/catalog` / agent-guide resources are in English.
- English tool descriptions: in English mode (`MIMI_SEED_LANG=en`, `mimi-seed lang en`, or a non-Korean system locale), every MCP tool and parameter description the agent sees is in English. Korean mode is unchanged. A machine with a non-Korean locale now gets English descriptions by default; set `MIMI_SEED_LANG=ko` (or `mimi-seed lang ko`) to keep Korean. Prompts sent to Claude for AI drafts stay Korean by design; the `language` / `locales` parameters choose the result language.

### Changed

- Google sign-in errors, their recovery hints, and the browser page shown after sign-in now follow your language setting (`MIMI_SEED_LANG`, then `mimi-seed lang`, then the system locale). Before this change they were always in Korean, and the callback-port message showed Korean and English together. Error codes are unchanged.

### Fixed

- Release Doctor tells you when it could not read part of the project. A folder or Gradle file it cannot open (permissions, another user's volume) now gives a `SCAN_PATHS_NOT_READ` warning naming the paths, and the report is no longer called clear; the apps it did read keep their verdicts. The Billing check (`android_check_billing_compliance` and Release Doctor) returns the paths in `unreadPaths` and reports `unresolved` instead of `pass` or `not_used`, and an unreadable Gradle file no longer aborts the whole Billing check.
- Release Doctor reads `eas.json` files with comments or trailing commas, as EAS CLI does, so their `ios.image` Xcode pins are checked. An `eas.json` that still can't be parsed keeps the iOS Xcode verdict at `IOS_XCODE_UNRESOLVED` instead of `IOS_XCODE_OK`.
- `mimi-seed doctor`, `setup`, and `deploy` show a corrupt credential or settings file as damaged, with the file and where it is broken, instead of "not set up" or "not logged in". `doctor` and `setup` no longer show a corrupt `tokens.json` or service account key as connected (✓) just because the file exists.
- `mimi-seed notes --from/--to` with a ref that doesn't exist (a typo, a missing tag) now stops with an error naming the ref and exits 1. It used to report "No commits found" and exit 0.
- The Google sign-in callback page decides which error to show by error type, not by whether the message starts with "YouTube". Channel-verification problems (mismatch, ambiguous channel) are still shown so you can fix them; other failures stay hidden. Its error response is now plain text with `nosniff`, so a channel title is never interpreted as HTML.
- A corrupt `.mimi-seed.json` is no longer treated as "no manifest". `mimi_seed_status` and `mimi-seed doctor` say the project's requirements could not be checked. Social posting refuses to fall back to the default account, because the manifest may have named another profile; pass `profile` explicitly to override.
- A broken service account key no longer silently switches identity. Drive, BigQuery, and Google Play stop with the file path instead of falling back to your OAuth account, and a broken per-package Play key no longer falls back to the legacy key. `mimi_seed_status` shows unreadable Play keys with ⚠️ and a broken BigQuery key with the reason.
- TikTok publishing blocks the post when its duplicate-prevention audit file is unreadable, instead of treating it as "no previous post".
- `mimi-seed mcp codex --write` no longer overwrites a `~/.codex/config.toml` that exists but cannot be read.
- Release Doctor no longer reports a pass when it could not read the evidence. A malformed `package.json` that mentions react-native-iap gives `BILLING_UNRESOLVED`, and an unreadable convention plugin source blocks `TARGET_SDK_OK`.
- `android_generate_keystore` runs `keytool` without blocking the MCP server, so other requests keep being answered while the key is generated. It now stops after 60 seconds with a message instead of hanging the server, and writes the temporary keystore to a private, randomly named folder.
- Keystore setup no longer reports `keytool` as available on a Mac without a JDK, where `/usr/bin/keytool` is only a stub. It checks for a JDK first, so the macOS "install a JDK" dialog does not appear.
- A credential file that exists but cannot be read (empty after an interrupted write, broken JSON, or no permission) is no longer reported as "not configured". The error now names the file and where it is broken, and `mimi_seed_status` lists every unreadable file under `~/.mimi-seed`. File contents are never included in the message.
- A sign-in error that was already classified (for example `CALLBACK_PORT_IN_USE`) keeps its code instead of being re-classified as `CODE_EXCHANGE_FAILED`.
- `appstore_verify_credentials` reports "no access to sales reports" only when App Store Connect actually returns HTTP 403. Before this change, another error whose text happened to contain "403" was also reported as a missing role.

### Tool changes

- none

## [0.24.0] - 2026-11-24

### Added

- Search Console tools accept a named Google login profile and offer a `gsc_readonly` OAuth grant for analysis. Sitemap submission requires the existing `gsc` grant.
- Search Console reports support Google-side filters, paging, and an aggregate-only response.

### Fixed

- Search Console breakdowns report the current page subtotal in `rowSummary`. Set `includeTotals: true` to also populate `summary` with a separate Google aggregate.
- Search Console reports return `null` when average position is unavailable. Sitemap reads omit the deprecated indexed URL count.

### Tool changes

- None.

## [0.23.4] - 2026-11-24

### Added

- GA4 CLI commands and MCP tools accept a named Google login profile. Reports accept a page size and row offset.
- Use the CLI service menu or MCP selection prompt to choose multiple work areas before loading tools. YouTube production and channel operations are separate choices.

### Fixed

- GA4 account, property, and stream discovery accepts read-only OAuth grants and follows all result pages.
- Paged GA4 reports sort by the requested dimensions. The CLI finishes writing large JSON reports before exiting.

### Tool changes

- None.

## [0.23.3] - 2026-11-24

### Added

- `release_status` accepts an exact Google Play version code and can disambiguate an App Store version by platform.
- Both stores' release plans and submission-risk checks expose a shared MCP output schema with the checked target, completion status, blocking codes, and risks. The App Store plan also accepts the expected social media policy inputs.

### Changed

- App Store release checks overlap screenshot lookups across localizations and start policy lookups as soon as the app info is available.
- App Store release status and review previews reuse related resources from the version response. App details omit unused version records.

### Fixed

- Google Play operations for the same app wait for the current edit to finish in the MCP process. Failed writes discard the edit if the commit has yet to start.
- `release_status` returns the build attached to the requested App Store version, normally in a single Apple API request. The legacy `recentBuilds` array contains only the attached build when verified.
- `release_status` reports multiple matches when a Google Play track has more than one release matching the request.
- Google Play release plans mark a completed release as done and skip the resubmission step.
- Google Play release note sync applies a repeated track only once.
- App Store review previews check all release-note pages against the selected version and require verified details for an attached build.
- App Store phased-release changes report an unverified result when the follow-up read cannot confirm the change.

### Tool changes

- None.

## [0.23.2] - 2026-11-24

### Added

- Upload and reuse App Asset Library screenshots and previews with a placement group.
- Reorder a localization's App Asset Library media and verify the saved order.

### Changed

- App Store submission checks and media listings read App Asset Library placements alongside legacy media sets.
- App Store submission checks verify screenshot processing state and batch known placements across localizations.
- App Store release plans reuse the selected version and attached build from one API response using the current version-state filter.
- App Store release checks verify the attached build's processing state before opening submission steps.
- App Store metadata, age ratings, and release checks share the same current app-info selection.
- Age-rating updates verify the original declaration without looking up the app's info records again.
- App Store release checks reuse privacy and age-rating data included with the selected app-info record.
- Google Play release plans use one edit and one track lookup for build selection and submission checks.
- npm release CI verifies the published package installs and runs before continuing to the next package.

### Fixed

- GitHub Actions dispatch ignores malformed run entries when identifying the triggered build.
- App Store submission stops if the existing review-submission list is missing from the API response.
- App Store readiness checks flag malformed responses and incomplete lists for review before submission.
- App Store risk checks and release plans require a verified version and platform, validate platform-specific privacy policies, and confirm that linked screenshot assets are ready.
- App Asset Library uploads preserve the asset ID during processing. Placement waits for a compatible processed asset in the target app's library.

### Tool changes

- Added `appstore_reorder_media_placements`.

## [0.23.1] - 2026-11-24

### Added

- The `game-intro-short` skill turns real gameplay into a short video with verified results and
  localized game footage, captions and narration. Install it with the Mimi Seed plugin.

- Google Play review lookups can return a bounded page of unanswered reviews with a continuation token.
  Package-only calls still return the original review array.
- Search App Store versions by version string and platform. Release checks and plans can target a specific
  App Store version or Google Play track and version code.

### Changed

- MCP prompts use the active toolsets. For targeted reads, Mimi Seed starts with the relevant tool and loads
  schemas as each step needs them. SDK-based AI drafting is available when requested.
- Release workflows stop on blockers or incomplete checks. They use the confirmed version for notes and
  show the exact target, locales, and text for approval before applying it.

### Fixed

- Google Play submission checks work with per-app service accounts.
- App Store review drafts stay with the original store. Reviews with incomplete reply information are
  skipped by the unanswered-review workflow.
- Release Doctor's directory-link tests run without elevated symlink privileges on Windows.

### Tool changes

- None.

## [0.23.0] - 2026-11-22

### Changed

- **Breaking change.** The CLI and local MCP server now require Node.js 22 or newer. Upgrade Node.js
  before installing this release. On the Node 22 line, building and testing from source requires
  Node.js 22.18 or newer.

- The CLI and the MCP server now depend on `@anthropic-ai/sdk` 1.x (API version 2026-10-21).
  `loadAnthropic` uses the named `Anthropic` export. Call sites already omitted `temperature`,
  `top_p`, and `top_k`, which the new API rejects.

- The MCP server no longer installs the `googleapis` meta-package (300+ API clients). It depends only on the
  16 `@googleapis/*` packages it actually calls, still loaded on first use through `googleapis-lite`.
  Those clients are now the current Node 22 generation (`googleapis-common` ^9, `^` ranges) rather than
  the Node 20 pins. The `gaxios` `7.1.5` override from the Node 20 generation is removed — it forced
  gaxios 7 onto libraries that declare `gaxios` ^8.3. Tool behavior is unchanged.
- The CLI and the MCP server load `@anthropic-ai/sdk` only when generating release notes, review replies, or
  video storyboards. `mimi-seed --version`, `mimi-seed check --local`, and MCP startup no longer load it.
  The SDK is now an optional dependency: default `npm install` still includes it, but
  `npm install --omit=optional` is enough for non-AI commands (`check`, `--version`, MCP tools that do not
  call Anthropic). Run `npm install --include=optional` in the same project to restore the SDK.

### Tool changes

- None.

## [0.22.0] - 2026-11-08

### Added

- **Google Drive domain** — create folders, upload files, replace a file's contents in place (same file ID and
  share link; Drive keeps the old version), rename / move, trash, list, and inspect. Uploads verify the MD5 after
  transfer and refuse a same-name file in the target folder unless asked to create another.
  Auth: a Drive service account (`mimi-seed auth drive`, or the key JSON body in `MIMI_SEED_DRIVE_SA_JSON` for CI
  and cloud sandboxes) for existing folders and shared drives; otherwise Google OAuth with the new `drive` domain
  (`drive.file` scope — files mimi-seed created only). Every call supports shared drives.
  The service-account path is the one verified for this release. The Google sign-in `drive` grant may be refused
  until the hosted sign-in is updated to offer the `drive.file` scope; use a Drive service account until then.
- `youtube_upload_video` accepts `defaultLanguage` (title/description language) and `defaultAudioLanguage` (spoken
  language) as separate fields. YouTube Studio upload defaults do not apply to API uploads, so these are now set
  explicitly. A video without speech leaves the audio language unset.
- Upload and `youtube_get_video_status` results include the category and both language fields as YouTube returned
  them (`null` when not reported), plus `commentModerationVerification: "requires_youtube_studio"` — the Data API
  cannot set or read the per-video comment filter.

### Fixed

- `mimi-seed-mcp --version` / `-v` and `--help` / `-h` now print and exit. They used to start the stdio server,
  which waits silently for a client and looked like a hang. Started by hand in a terminal, the server now says on
  stderr that it is waiting for an MCP client and how to exit; clients see no change.
- Editing a video's title, description, or tags no longer clears its spoken-language setting.

### Tool changes

- Added: `drive_auth_status`, `drive_list_files`, `drive_get_file`, `drive_create_folder`, `drive_upload_file`,
  `drive_update_file_content`, `drive_update_file_metadata`, `drive_trash_file`.

## [0.21.8] - 2026-11-08

### Changed

- The MCP server now validates tool input with zod 4. Tool names and parameters are unchanged, but the JSON
  Schema in `tools/list` is rendered differently: object schemas no longer declare `additionalProperties: false`
  (unknown arguments are still ignored, as before), shared enums are inlined instead of `$ref`'d, and integer
  and URL parameters carry explicit bounds and `format`.
- UUID parameters of the video tools are checked against the RFC 4122 format. IDs generated by Mimi Seed already
  satisfy it.

### Security

- `zod` 4 resolves the high-severity advisory about memory exhaustion while validating oversized constrained
  collections. `npm audit --omit=dev` reports no vulnerabilities for either package.

### Tool changes

- None.

## [0.21.7] - 2026-11-08

### Changed

- Dependency updates for both packages: `@anthropic-ai/sdk` 0.137.0, and for the MCP server
  `@modelcontextprotocol/sdk` 1.32.2, `@onesub/providers` 0.5.0, and `jose` 6.2.15.

### Security

- The MCP server's lockfile pulls patched versions of transitive dependencies flagged by `npm audit`:
  `proxy-addr` (critical), `body-parser` (high), `hono` and `@hono/node-server`, `fast-uri`, `ip-address`, and `qs`.
  They arrive through `@modelcontextprotocol/sdk`'s HTTP transport, which Mimi Seed does not use (it runs over
  stdio), but installs no longer report them. `zod` still has an open advisory that needs the 3 → 4 major upgrade.

### Tool changes

- None.

## [0.21.6] - 2026-11-08

### Changed

- App Store sales reports over a date range fetch daily reports four at a time instead of one by one, so long
  ranges finish much faster. Results are still merged in date order.
- App Store Connect requests reuse a signed JWT per API key until five minutes before it expires instead of
  signing a new one for every request. Replacing or re-registering a key invalidates the cached token.

### Fixed

- Parallel tool calls on the same Google profile no longer each refresh the OAuth access token; they share a
  single refresh.
- Play Store tools that fall back to OAuth refresh the token before use, so an expired session reports a
  re-authentication hint instead of a raw `invalid_grant` error. Scope checks now use the freshly refreshed token
  rather than a stale copy re-read from disk.
- When one day of an App Store sales report range fails, no further daily requests are started.

### Tool changes

- None.

## [0.21.5] - 2026-10-04

### Fixed

- Google resource-ID regression tests now compare decoded path segments, accepting both literal and
  percent-encoded colons in Firebase app IDs and BigQuery project IDs while preserving path structure
  and traversal rejection checks.

### Tool changes

- None.

## [0.21.4] - 2026-10-02

### Added

- `SECURITY.md` — how to report a vulnerability privately, which versions get fixes, and what is in scope. It also
  ships inside the Codex plugin bundle.

### Changed

- CLI and setup-bin output now follow the system locale when neither `MIMI_SEED_LANG` nor a saved `mimi-seed lang`
  choice exists: a Korean locale (`LC_ALL` / `LC_MESSAGES` / `LANG`, or the OS locale on Windows) gets Korean,
  anything else English. It used to be Korean for everyone. The first-run `setup` prompt's Enter default follows
  the same rule.
- Release Doctor judges the Android targetSdk per app module and says "meets the minimum" only when every app
  module's value was resolved from evidence it fully understands. A module it cannot evaluate (a Gradle property or
  convention plugin it cannot read, a repository script it cannot follow, an unrecognised way of setting
  `targetSdk`) makes the result unresolved and cites the file and line; a value below the minimum is still a
  blocker. It now reads version catalogs the way Gradle resolves them, `buildSrc` / `build-logic` / included-build
  convention plugins (Kotlin, Groovy, Java), applied scripts, workspace packages, and Gradle properties. Scripts of
  JavaScript packages (`node_modules/`, React Native autolinking, Sentry, Expo) are read when found and otherwise
  listed in a new info item, `TARGET_SDK_THIRD_PARTY_SCRIPTS_NOT_READ`. The JSON report gains `targetSdkModules` and
  `targetSdkTokens`. `findProperty("x") ?: N` defaults are no longer taken as the module's value. Library, sample,
  and Wear OS / TV modules are left out unless they configure another project. The check stays deliberately
  conservative; what it does not model — including the few shapes that can hide a setting — is listed in "Known
  limits of the Target API check" in the user guide's Release Doctor validation page.
- Release Doctor no longer prints "No submission blocker was found" when a check could not reach a verdict (an
  unresolved targetSdk, Billing, or Xcode version, a stale policy table, a Wear OS/TV module); the summary says the
  check is incomplete and names those items. They are also listed in the JSON report as `coverage.unresolved`.
- Release Doctor labels undecided info items `NEEDS CHECK` (Korean `확인 필요`, where `확인` read as "confirmed");
  other info items are `INFO` (`정보`).
- Release Doctor Billing findings show their evidence (file and resolved expression, including why a version is
  unresolved), a passing Billing check no longer suggests an upgrade, and the Korean action matches the English one.

### Fixed

- Release Doctor missed a Play Billing blocker for React Native apps using `react-native-iap` when the package was
  not installed (a fresh clone or CI): the version pinned in `yarn.lock` / `package-lock.json` / `pnpm-lock.yaml`
  (also at the repository root when `--path` points into a workspace) is now mapped to the Billing version that
  release bundles, verified against every stable `react-native-iap` release through 16.7.2 — e.g. 12.15–13.x →
  Billing 7, a blocker since 2026-08-31. An installed 12.5–13.x and an app's `ext.playBillingSdkVersion` override are
  read too (only from the app's own root build script, comments ignored; Groovy `ext` and Kotlin `extra[…]` /
  `extra.set(…)` forms; an override Release Doctor cannot evaluate makes the result unresolved instead of using the
  default; local variables and `subprojects { … }` extras are not overrides). react-native-iap installed under another
  name (`"iap": "npm:react-native-iap@…"`, including pnpm v9 lockfiles) is recognised, and a fork installed under
  another name is reported as unresolved. pnpm v5/v6 single-project lockfiles are
  read; newer or unknown releases, and `npm:` aliases that install a fork under the react-native-iap name, stay
  unresolved.
- A Wear OS, TV, Automotive, or XR module no longer switches off the Target API check for the whole repository; the
  phone app is still checked, and the specialized module is reported for a category-specific check. A module that has
  the phone launcher (in its main or a flavor manifest, or in a library module merged into it) keeps the phone rule; a
  module with only the TV launcher, or whose main manifest requires leanback (unless a flavor removes or relaxes that
  with `tools:node="remove"` / `tools:replace`), is a TV app. Debug-only manifests are ignored.
- Android application IDs: strings, templates, comments, local variables, and extra properties
  (`ext.applicationId`, `ext { applicationId = … }`) that mention `applicationId` are no longer reported as IDs (or
  as extra app modules); `applicationId` read from the version catalog or `gradle.properties`,
  and the `namespace` fallback, are resolved. An app module declared through a convention plugin or a buildSrc
  constant (`id(BuildPlugins.androidApplication)`, `libs.plugins.androidApplication`) or only by an
  `applicationId = <expression>` assignment is still detected and checked; an ID Release Doctor cannot evaluate is
  reported as unresolved with the expression.
- targetSdk set in a script pulled in with `apply from:` (e.g. `common.gradle`), in a Kotlin DSL root script
  (`extra["targetSdkVersion"] = 36`), or in Expo's `expo-build-properties` plugin is now read instead of reported as
  unresolved, as are targetSdk values named through Gradle properties or extras (`gradle.properties`,
  `project.property("x")`, `rootProject.ext.x`, `set("x", 36)`, `val x: String by project`, a single local such as
  `def x = 36` or `val x = libs.versions.x.get().toInt()`) and AGP's `targetSdk { version = release(36) }`, plus
  values a build root sets for every module in `subprojects { … }` / `allprojects { … }`. A property counts only from
  the module's own build (gradle.properties on the path from its settings directory, not other modules, included
  builds, or demo trees, unless the module itself lives there); a name that CI overrides (`-Px=`,
  `ORG_GRADLE_PROJECT_x`), that has competing declarations, is assigned from an expression, or that two sources
  disagree on stays unresolved rather than guessed. Version catalogs resolve the way Gradle does: from the
  module's own build's settings (`versionCatalogs { create(…) { from(files(…)) } }`, any accessor such as
  `androidx.versions.*`, `$rootDir` paths, and literal `version("x", "33")` overrides in any call shape) plus the default
  `gradle/libs.versions.toml`, so a nested build and the repository root (or two builds sharing a key) no longer
  overwrite each other's values; a `version` call it cannot parse leaves that catalog unresolved
  (`library(…).version(…)` is not one). A `subprojects` / `allprojects` value always counts next to the module's own
  (the lowest wins), a local variable counts only when declared before its use in an enclosing block, an extra
  property is looked up only in the module's own project hierarchy, `ext.targetSdkVersion = …` is a property
  definition rather than the module's targetSdk, and a name a settings script sets for every project
  (`gradle.beforeProject { … }`) stays unresolved. Calls with nested parentheses
  (`targetSdkVersion(libs.versions.targetSdk.get().toInt())`, `Integer.parseInt(…)`) are read in full. Every way of
  applying the application plugin counts (`apply { plugin(…) }`, `pluginManager.apply(…)`, a multi-line `id(…)`);
  a build script that only mentions it (`hasPlugin(…)`, `withId(…)`, `listOf(…)`, `apply false`) is not an app
  module. Comments are
  removed with a string-aware reader (including Groovy slashy strings),
  so a glob such as `pickFirst '**/*.so'` or a URL no longer hides the code after it.
- Example, sample, demo, and test apps (and component packages' sample apps) no longer supply the identifiers,
  targetSdk verdict, or cited file when the repository has a real app, so a monorepo's example app no longer causes
  `MULTIPLE_*` warnings or a blocker that cites the wrong file. Excluded app modules whose targetSdk is below the
  minimum are listed in an info item, so a real app kept in a `demo/` folder is not dropped silently; when the only
  app lives in `demo/`, its Xcode pins (when the iOS app is there) and FCM sources are still checked.
- A Billing blocker in a repository with several apps names only the versions below the minimum and cites the
  failing app's file.
- iOS bundle IDs written as `$(VAR)` / `${VAR}` are resolved from `.xcconfig` files and XcodeGen `project.yml`
  settings; when they cannot be resolved, Release Doctor reports them as unresolved instead of borrowing a nested
  sample project's ID. Framework, test-bundle, and Debug/Profile/Test-only IDs are left out (`TestFlight`
  configurations are kept).
- `MULTIPLE_IOS_BUNDLE_IDS` no longer fires for one app plus its extensions, widgets, and watch app, and
  `…UITests` IDs are filtered.
- With `--path` inside a repository, the root Gradle version catalog is read, and when the path itself has no Xcode
  evidence the repository root's CI pins are cited as a `NEEDS CHECK` item (they may build another app, so they
  never decide the verdict or cancel one found inside the path). Composite actions
  (`.github/actions/**/action.yml`) count as Xcode pin sources, and Xcode Cloud `ci_scripts/` are reported as such.
- The reusable Release Doctor workflow, and the CI command `check --local` suggests for projects that declare
  `devEngines` (in PowerShell form on Windows), run `npx` with a throwaway prefix; inside such a project npm stopped
  `npx` with `EBADDEVENGINES` before Release Doctor started. The pilot guide and troubleshooting document the workaround.

### Tool changes

- none

## [0.21.3] - 2026-10-01

### Fixed

- `mimi-seed-googleads-auth` reported "undefined account(s)" after a successful connection check; it now prints
  the number of accessible Google Ads accounts. A non-JSON success body from a proxy on that check is no longer
  echoed into the error message. `googleads_list_accessible_customers` now returns `{"resourceNames": []}` instead
  of `{}` when no account is accessible, and rejects a malformed success response instead of passing it through.
- A hand-edited `~/.mimi-seed/google-ads.json` with an unquoted numeric `customerId` / `loginCustomerId` was read
  as "no Google Ads config"; numbers are now accepted. A file missing `developerToken` or `customerId`, or with an
  invalid `loginCustomerId`, is now reported as not configured — by both the MCP tools and `mimi-seed doctor` —
  instead of failing later.
- `mimi-seed notes` now stops with an error for a missing or out-of-range `--limit` (1–10000) or a `--from` /
  `--to` starting with `-`, instead of reporting "No commits found". The latest tag is read as `refs/tags/<tag>`,
  so a tag named like `HEAD` or starting with `-` is still used as the range start.
- `mimi-seed restart` now finds servers registered as a bare command (`"command": "mimi-seed-mcp"` with no args,
  as `scripts/install.mjs --link` registers it), servers run through `ts-node`, servers launched through npm or
  pnpm shims (`…/.bin/../<package>/…`), on Linux and macOS servers started from a relative script path or a path
  containing spaces, and on Windows the actual `node` server behind `npx` or an npm `.cmd` shim.
- A Google Ads API error whose JSON `details` contained a `null` entry was reported as ": non-JSON response" and
  lost the provider's message, codes, and `requestId`; those are now kept.

### Security

- `mimi-seed notes` no longer passes git refs through a shell. A repository tag name may contain `$(…)`, `;`, or
  `|`, so running it in a repository with a crafted tag (or passing such a value to `--from` / `--to`) could run
  a command. A ref starting with `-` is now rejected instead of being read as a `git log` option.
- `mimi-seed restart` no longer builds a `cmd.exe` / PowerShell command line from the MCP server's configured
  arguments, which may come from a repository's `.mcp.json`. On Windows it now reads the process list and matches
  it in the CLI, so quotes in an argument (including Unicode curly quotes) can no longer run a command.
- `mimi-seed restart` could kill unrelated processes chosen by the configured arguments: it matched any command
  line containing that text (`node`, a single letter, a bare `index.js`, or a program name such as `explorer`).
  It now stops only your own (on Linux and macOS) Node / Bun / Deno / Python processes whose **script** — the
  file or `-m` module the runtime is running — is the configured server: a script path must match (a relative
  path is resolved against that process's working folder), and a package must be the script's bin name or that
  bin's entry file inside the package's `node_modules/` folder — so the package's other commands, such as a setup
  wizard running at the same time, are not stopped. Shells and `npm exec` / `npx` / `cmd /c` wrappers are left alone; they exit
  when the server does. With the default server name every marker must be the `@yoonion/mimi-seed-mcp` package or
  bin, or that package's server entry script (found through its `package.json`), so a repository's `.mcp.json`
  cannot point it at your other processes — at most at a process running that repository's own files; and it
  kills nothing — reporting the count — when more than 10 server processes match.
  Not restarted (it reports that no process was found): Docker and native-binary servers; on Windows, a server
  started from a relative script path, because Windows does not expose another process's working folder; and on
  Linux and macOS, an `npx` server whose npm cache path contains a space.
- On Windows, `mimi-seed notes`, `doctor`, `restart`, and the setup commands no longer run an executable placed in
  the current folder: `powershell.exe` and `taskkill.exe` are called by absolute path, and `git` and the
  `mimi-seed-*` setup shims are looked up only in absolute `PATH` entries.

### Tool changes

- none

## [0.21.2] - 2026-09-29

### Added

- Naver Search Advisor tools. Naver publishes no webmaster API, so these cover the two parts that can be automated:
  `naver_check_page` reports what Naver's crawler (Yeti) sees for one URL — the redirect chain (302 vs 301),
  whether `robots.txt` lets Yeti in (a `User-agent: Yeti` group overrides `*`), noindex from meta or
  `X-Robots-Tag`, canonical, title / description / Open Graph, and pages whose raw HTML has almost no text
  because JavaScript draws them. `naver_indexnow_submit` sends new, changed, or deleted URLs to Naver's IndexNow
  endpoint. It first fetches your `<key>.txt` key file and sends nothing if the file is missing or doesn't match.
  Sitemap and RSS submission remain in the Search Advisor console.

### Tool changes

- Added: `naver_check_page`, `naver_indexnow_submit`.

## [0.21.1] - 2026-09-28

### Added

- MCP tools can now run and follow a Jenkins build: `jenkins_trigger_build` starts a job (`/build`, or
  `/buildWithParameters` when `parameters` is given), `jenkins_get_queue_item` turns the returned queue id into
  the exact build number, and `jenkins_get_build_status` reports `building` / `result` for that build. Before, an
  agent had to call Jenkins' REST API itself, and the docs said there was no trigger tool.
- `jenkins_trigger_build` is confirm-gated like other destructive tools (a job may deploy or publish): without
  `confirm: true` it only returns the `🛑 DRY-RUN` preview. It also takes a `request_id` you choose per logical
  build request and sends at most one POST per `request_id` on this machine. The first confirmed call reserves
  the id under `~/.mimi-seed/jenkins-build-requests/` (per Jenkins URL and user) and records the outcome there;
  any later call with the same `request_id` returns that record (`replayed: true`) instead of starting the job
  again, and reusing it with a different job or parameters is refused. The preview does not reserve the id, so
  preview and confirm with the same `request_id`. A replay while the first call is still in flight reports
  `state: "pending"`. An outcome that cannot be confirmed (timeout, network error, 5xx, 429, redirect, or a `201`
  without a queue location) is reported as `state: "unknown"` and is never retried automatically — check Jenkins
  before doing anything. Once the request may have reached Jenkins the tool always returns a result: if only the
  local record fails to save it answers `persisted: false`, and a queued build keeps its `queue_id` with a "do not
  retrigger" note. It sends the CSRF crumb when the server issues one (without following redirects) and stops
  before the POST if the crumb cannot be fetched. It reads the queue id from `Location` even when a reverse proxy
  rewrites the context path, but always polls the configured URL. The record holds only an HMAC fingerprint
  (keyed by a random per-install `.key`), the state, the queue id, and the HTTP status, never parameters or the
  API token. This is local deduplication, not a Jenkins guarantee: another machine or a deleted record can run the
  same request again.

### Security

- Jenkins job paths passed to any `jenkins_*` tool (`jenkins_get_job_config`, `jenkins_create_job`,
  `jenkins_update_job`, `jenkins_list_jobs` `folder`, and the new build tools) are now encoded with the shared
  path-segment encoder, which refuses `.` and `..` segments. Before, `team-folder/..` was sent unchanged and URL
  normalization could point the request at another job or folder. The new build tools also refuse empty segments,
  backslashes, and control characters, and take `queue_id` / `build_number` only as positive integers.
- Dry-run previews of confirm-gated tools now also redact secret-looking keys nested inside object or array
  arguments (for example `parameters: { DEPLOY_TOKEN: … }`), not only top-level ones. Previews without such keys
  are unchanged.

### Fixed

- `playstore_list_reviews` now returns the developer's published reply. Each review gains a top-level
  `developerComment` (`{ text, lastModified }`, or `null` when unanswered), and `comments` keeps reply entries
  instead of turning them into empty user comments. Before, answered reviews looked unanswered, so the
  "reply to unanswered reviews" flow could reply again and replace an existing answer (Play keeps one reply per
  review). The review-reply prompt and the Play skill now select reviews whose `developerComment` is `null`.
  It also follows `nextPageToken` (up to 10 pages of 100) instead of returning only the first page, and when a
  review carries more than one reply it reports the most recent one. If a later page fails or the page cap is
  reached, the reviews fetched so far are still returned, followed by a separate `⚠️ 일부만 조회됨` notice; a
  failure on the first page is still an error.
- `appstore_list_reviews` always reported `response: null`. The request's sparse fieldset for `customerReviews`
  left out the `response` relationship, so included replies could not be matched to their reviews and every
  review looked unanswered. Answered reviews now carry their reply.

### Tool changes

- Added: `jenkins_trigger_build` (destructive, confirm-gated), `jenkins_get_queue_item`, `jenkins_get_build_status`.
- None renamed or removed. `playstore_list_reviews` output gains `developerComment`.

## [0.21.0] - 2026-09-28

### Changed

- **Contributors:** code the CLI and the MCP server both need now lives once in `packages/core`, private,
  dependency-free source that each package compiles into its own output (the CLI bundles it, the MCP server
  emits it to `dist/core/`). This covers Release Doctor, the `.mimi-seed.json` reader, the output-language rule,
  atomic credential writes, the AI model id and generator contract, the endpoint-label/timeout helpers, and the
  `ci.json` / `jenkins.json` shapes. Removed with the copies: the CLI's Release Doctor mirror,
  `scripts/sync-release-doctor.mjs` with its `release-doctor:sync` / `release-doctor:check` scripts, and the
  `manifest-schema-parity`, `rename-retry-parity`, and `ai-parity` tests. `core-boundary.test.ts` guards the new
  package. Nothing changes for users: both npm packages still install on their own, and the MCP tarball only
  gains `dist/core/`. The Release Doctor files and a few `lib/` modules moved there from their old `dist/` paths.

### Removed

- The deprecated aliases announced in 0.20.0 are gone: `playstore_update_latest_release_notes` (use
  `playstore_update_release_notes` and omit `versionCode` — `syncTracks` works the same) and
  `appstore_attach_latest_build` (use `appstore_attach_build` and omit `buildId` — `minBuildNumber` works the
  same). Calling an old name now fails as an unknown tool. The MCP server registers 2 fewer tools.

### Tool changes

- **Removed** `playstore_update_latest_release_notes` → use `playstore_update_release_notes`.
- **Removed** `appstore_attach_latest_build` → use `appstore_attach_build`.
- No tools were added or renamed. The tool count drops from 244 to 242.

## [0.20.0] - 2026-09-27

### Upgrading from 0.19.x

Agent prompts, skills, and scripts written against 0.19.x need these changes (details under `Tool changes`):

- **Preview, then confirm.** Destructive tools no longer act on the first call: without `confirm: true` they
  return a dry-run preview and change nothing. Show it to the user, then repeat the same call with
  `confirm: true`. This includes store submit / promote (every status, including `draft`), deletes, image
  replacement, review replies, social posts, IAM key creation and bindings, Jenkins job changes, and CI cancel.
- **Jenkins credentials:** replacing an **existing** id with `jenkins_create_credential`, `jenkins_upload_keystore`,
  or `jenkins_upload_playstore_sa` returns an "already exists" dry-run (showing the existing credential) instead
  of overwriting it; add `confirm: true` to replace. New ids are still created directly.
- **Secrets are returned as file paths.** `iam_create_key` returns the saved key **path** (under
  `~/.mimi-seed/keys/`), and `android_generate_keystore` returns the **paths** of `upload.jks` and `signing.json`
  (under `~/.mimi-seed/keystores/`) — no private key JSON, passwords, or keystore base64. Pass the paths on:
  `service_account_json_path` / `serviceAccountJsonPath`, `keystore_path`, `secret_file` + `secret_field`.
- **`ffmpegPath` is gone** from `video_render`, `video_validate`, and `tiktok_business_plan_video_post`; set
  `MIMI_SEED_FFMPEG_PATH` (and `MIMI_SEED_FFPROBE_PATH`) instead — a passed `ffmpegPath` no longer selects the
  binary.
- **Stricter ids.** `packageName` / `package_name(s)` / `bundleId` must be valid Android package names / iOS bundle
  ids, and ids that end up in Google resource names or provider request paths are validated or encoded. Malformed
  values that used to reach the API are now rejected up front.
- **`bigquery_run_query` is `SELECT`-only.** DML, DDL, and multi-statement scripts (including
  `CREATE TEMP FUNCTION …; SELECT …`) are rejected; single `SELECT` and pipe-syntax queries still run.
- **Invalid-argument text changed.** Validation errors are readable lines (`… at packageName`) instead of the raw
  zod issue JSON; the `-32602` code and `isError` are unchanged. Don't parse the old JSON.
- **Deprecated aliases** `playstore_update_latest_release_notes` and `appstore_attach_latest_build` still work but
  are **removed in 0.21.0** — switch to `playstore_update_release_notes` / `appstore_attach_build`.
- **Release Doctor in CI:** `mimi-seed check --fail-on-blocker` / `mimi-seed-release-doctor --fail-on-blocker` can
  newly fail when every Xcode version the project pins is below Apple's App Store Connect upload minimum
  (`IOS_XCODE_BELOW_MINIMUM`).

### Added

- `mimi-seed doctor --json` prints the whole diagnosis as one machine-readable report, including an `ok` flag.
- `mimi-seed doctor --strict` exits with code 1 when any ✗ check fails, for CI gating. Without it, `doctor` still
  only reports and exits 0.
- CI runs both packages' test suites on Windows (Node 22) in addition to Linux (Node 20 and 22).
- `CHANGELOG.md` (this file), with a `Tool changes` convention for MCP tool additions, renames, and removals.
- Every MCP tool now carries MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`) and a readable `title`, derived from the read / write / destructive classification in
  `tool-manifest.json` (mirrored by the **W** / **D** markers in `docs/domain/tool-catalog.md`). Clients that honor
  annotations can now auto-approve reads and warn before destructive calls.
- Destructive tools are confirm-gated by the server: called without `confirm: true` they return a dry-run
  preview and change nothing; the call with `confirm: true` runs it. Tools that already had their own flag
  (`confirmPublish`, `confirmVisible`, `confirm` on submit/release/recovery tools) keep it.
- `MIMI_SEED_TOOLSETS` / `MIMI_SEED_TOOLSETS_EXCLUDE` limit which tool domains the local MCP server exposes
  (domain keys such as `playstore`, or the groups `store`, `google`, `social`, `media`, `build`, `all`). Unset
  means every domain, as before; `auth` and `checks` are always on; unknown keys are ignored with a warning.
  `mimi_seed_status` shows the active toolsets.
- Release Doctor checks the pinned Xcode against App Store Connect's upload minimum (Xcode 16 / iOS 18 SDK from
  2025-04-24, Xcode 26 / iOS 26 SDK from 2026-04-28), reading `.xcode-version`, GitHub Actions, GitLab CI,
  `Jenkinsfile`, fastlane, Codemagic, and `eas.json`. New findings: `IOS_XCODE_BELOW_MINIMUM` (**blocker** — only
  when every piece of Xcode evidence is a resolved pin below the minimum), `IOS_XCODE_MIXED_PINS` (warning — an old
  pin next to newer or unpinned evidence), `IOS_XCODE_UNRESOLVED` and `IOS_XCODE_OK` (info), and
  `IOS_SDK_POLICY_REFRESH_REQUIRED` (warning — the embedded minimum table is out of date). (#34)
- Release Doctor flags legacy Firebase Cloud Messaging usage in project sources: `FCM_LEGACY_SEND_API` (warning —
  `fcm/send` is already shut down), `FCM_INSTANCE_ID_API`, `FCM_LEGACY_TOPIC_METHODS`, `FCM_DEVICE_GROUP_API`, and
  `FIREBASE_ADMIN_LEGACY_TOPIC_TRANSPORT` (firebase-admin before 14.5.0) — info until the 2027-09-29 Instance ID
  decommission, warning after. The scan skips `.claude` and `.worktrees` everywhere, and ignores Xcode pins and FCM
  sources inside nested repositories, third-party checkouts, test / fixture / vendor trees, and `doc(s)` /
  `example(s)` / `sample(s)` directories (manifests there are still read). (#34)
- `mimi-seed --version` (also `-v` and `mimi-seed version`) prints the CLI version and exits 0. It used to report an
  unknown command and exit 1.

### Changed

- Dependencies: `@modelcontextprotocol/sdk` 1.30, `googleapis` 178.0 (the last release that still supports Node
  20), `@anthropic-ai/sdk` 0.128 (both packages), `jose` 6, and `open` 11 (both packages). The Node floor stays
  at 20. The dependency bump by itself changes no tool names or schemas — this release's intended tool and schema
  changes are listed under `Tool changes`. With the MCP SDK update, an invalid tool argument is reported as
  readable lines (for example `… at packageName`) instead of the raw zod issue JSON; the `-32602` error code and
  `isError` are unchanged.
- Releases publish only on a `v*` tag push (the tag must equal the root version and point at a commit on `main`);
  pushing to `main` runs tests only. Both packages publish from one job that runs only after every test leg
  passes, mcp-server first, so a failed mcp-server publish stops the cli publish instead of leaving a lone cli
  release.
- `mimi-seed doctor`: the Mimi Seed cloud token is only treated as required when remote use is configured (`MIMI_SEED_TOKEN`, `MIMI_SEED_WEB_BASE`, or a
  `.mimi-seed-link.json` in the project); local-stdio-only setups now get a warning instead of a failure. App
  Store Connect only fails when the project has an iOS app, so Android-only projects pass.
- When a setup binary is not on `PATH`, the CLI runs `npx @yoonion/mimi-seed-mcp@<its own version>` instead of
  whatever npm `latest` is, so a CLI is never paired with a mismatched MCP server. A CLI run from a source
  checkout (whose version may not be on npm yet) uses `@latest` and says so.
- Remote MCP calls from the CLI wait up to 2 minutes, and store writes (`apply_release_notes`,
  `playstore_reply_review`, `sync_apps`) up to 5 minutes, so a slow write is not cut off with an unknown outcome.
- The CLI's command help moved to `packages/cli/src/help.ts` and `mimi-seed init` to `packages/cli/src/init.ts`
  (internal refactor; no behavior change).
- MCP tools are registered through `McpServer.registerTool` instead of the deprecated `server.tool` API
  (internal; the migration by itself changes no tool names or schemas).
- **Agents must now preview then confirm** destructive calls (see `Tool changes` for the list). Skills, the
  agent guide, and the `review-inbox` prompt describe the new call order.
- Contributors: the tool catalog, the README tool tables, and the agent-guide `select:` batches are now generated
  from `tool-manifest.json` by `npm run plugin:sync` (`scripts/gen-docs.mjs`) instead of being edited by hand.
- The `mimi-seed://tools/catalog` resource describes the server that is actually running: with
  `MIMI_SEED_TOOLSETS` / `MIMI_SEED_TOOLSETS_EXCLUDE` it lists only the registered tools, and `total` is the
  registered count (`manifestTotal` keeps the full inventory). Each domain now carries `write` and `destructive`
  lists, deprecated aliases moved out of the domain `tools` into a top-level `deprecated` map (alias → replacement),
  and a `toolsets` block reports the active selection.
- The "already exists" dry-run of `jenkins_create_credential`, `jenkins_upload_keystore`, and
  `jenkins_upload_playstore_sa` shows the existing credential's id, kind, name, and description and states
  `confirm: true will REPLACE this existing credential: …`. Default ids come from the package's last segment only
  (`com.foo.app` and `com.bar.app` both default to `app-playstore-sa`); the derivation is unchanged, but the dry-run
  now warns when an id has that default shape with a generic prefix such as `app`, and `android_signing_setup`
  warns about it up front. `jenkins_upload_playstore_sa` now gives the credentials it writes the description
  `Play Store service account for <packageName>`, so a later collision is recognizable.
- `android_signing_setup` no longer tells the agent to pass `keystore_base64` / `secret` values through the
  conversation for an existing app (or when keytool is missing). The plan has the user copy the keystore into
  `~/.mimi-seed/keystores/<packageName>/` and write the passwords to `signing.json` there, then registers them with
  `keystore_path` and `secret_file` + `secret_field`.
- The `deploy`, `playstore-publish`, `appstore-publish`, and `video-create-publish` skills now load every tool their
  steps call in their `select:` batches (the deploy batch missed `playstore_submit_release` and
  `appstore_check_submission_risks`), and `mimi-seed-update` describes tag-only releases: npm `latest` moves only
  after the `v*` tag publish.

### Deprecated

- `playstore_update_latest_release_notes` — use `playstore_update_release_notes` without `versionCode`.
- `appstore_attach_latest_build` — use `appstore_attach_build` without `buildId`.

Both still work (same schema and behavior as their replacement, description prefixed `[DEPRECATED …]`) and will
be removed in 0.21.0.

### Fixed

- Every outbound HTTP call in the CLI (GitHub, GitLab, Jenkins, the web console, telemetry) now has a timeout, so
  a hung server can no longer freeze `deploy`, `doctor`, or `init` indefinitely. A timeout while a response is
  still streaming shows the same readable message instead of a raw `AbortError`.
- Jenkins queue and build-status lookups failed for a controller URL saved with a trailing slash; all Jenkins
  calls now normalize the URL the same way.
- The Jenkins credential kind check no longer mistakes the credentials store's wrapper class (which the per-id
  API reports as `_class`) for a different kind, which blocked replacing any existing credential. When `_class` is
  the wrapper, the kind comes from the English type name (requested with `Accept-Language: en`: `Secret text`,
  `Secret file`, `Username with password`, `SSH Username with private key`, `Certificate`, …) or, failing that,
  from the root element of the credential's `config.xml`. A known kind that differs from the requested one is
  refused even with `confirm: true`. If the kind still cannot be determined (a localized or empty type name and no
  readable `config.xml`), the replace is not blocked, but the dry-run says that the existing kind could not be
  verified and names the kind it would be replaced with.
- The CLI's credential files (`ci.json`, `config.json`, `telemetry.json`, and the legacy Jenkins migration) are
  written atomically with `0600` permissions; an interrupted write can no longer leave a truncated file or a
  briefly world-readable token.
- `doctor` no longer aborts when the Mimi Seed server is unreachable; it reports one failed check and finishes.
- List tools no longer stop at the first page: IAM service accounts, Firebase projects and enabled services,
  and Play one-time products and subscriptions follow every `nextPageToken`. The Play product lists return what
  was fetched with `truncated: true` and a note if they hit the page cap.
- `bigquery_run_query` waits up to 2 more minutes for a query that misses the 30 s window and, if it still has not
  finished, says so with `jobComplete: false` and the `jobId` instead of returning an empty result.
- Google API calls made through `googleapis` now have a 60 s timeout with bounded retries (Play `edits.commit`
  5 min, media uploads 3 h — override with `MIMI_SEED_UPLOAD_TIMEOUT_MS`), so a hung connection can no longer
  freeze a tool call indefinitely.
- On Windows, credential writes retry briefly (up to 1 s) when antivirus, the search indexer, OneDrive, or another
  mimi-seed process holds the file open, instead of failing with `EPERM`.
- `CALLBACK_PORT_IN_USE` names the loopback address that is taken and how to find the process holding it.
- `bigquery_run_query` also rejects non-`SELECT` SQL lexically before any API call, and that check ends `--` / `#`
  comments at `\r` as BigQuery does — `SELECT 1 -- x\r; DROP TABLE t` no longer hides its second statement.
  Pipe-syntax queries (`FROM t |> …`) are accepted; `CREATE TEMP FUNCTION …; SELECT …` scripts are rejected with
  an explanation.

### Security

- Package and bundle ids are validated on every tool, and service-account file paths are checked to stay inside
  `~/.mimi-seed/play-service-accounts/`. A `packageName` like `../tokens` could previously delete, overwrite, or
  remote-sync the Google OAuth token file.
- `mimi_seed_remote_sync_credentials` only sends registered service accounts (or, with the legacy single SA, any
  well-formed package name), skips and lists anything else, requires an https endpoint (http only for
  localhost), and shows the destination host in the preview.
- Ids interpolated into App Store Connect, Meta (Facebook/Instagram/Threads), Google Ads, and GitHub/GitLab
  request paths are encoded, and ids used in Google resource names (Firebase, IAM, GA4, AdMob, Billing, BigQuery,
  Search Console, Play) are validated, so a crafted id can no longer redirect a request — including a `DELETE`
  or `:remove` — to another resource or project.
- Secrets are no longer returned into the conversation: `iam_create_key` saves the key under `~/.mimi-seed/keys/`
  and `android_generate_keystore` saves the keystore and its passwords under `~/.mimi-seed/keystores/` (both
  `0600`), and keytool receives passwords through environment variables instead of the command line. The
  `playstore_upload_data_safety` preview no longer echoes CSV content.
- `bigquery_run_query` enforces read-only: a dry run rejects anything that is not a single `SELECT`. BigQuery
  ids follow BigQuery's own naming rules (Unicode/space table names and numeric project numbers are accepted).
- The Google login callback listens only on `127.0.0.1` and `::1` instead of every network interface.
- FFmpeg can no longer be pointed at an arbitrary program from a tool call; it is configured only by
  `MIMI_SEED_FFMPEG_PATH` / `MIMI_SEED_FFPROBE_PATH` / `PATH`.
- `jenkins_save_config` warns when the Jenkins URL sends the API token over plain http to a public host
  (LAN / Tailscale http stays allowed).
- mcp-server dependency advisories fixed (`fast-uri`, `ip-address`, `hono`, `qs`, `nanoid`).

### Tool changes

- No tools were added or removed. Two tools become deprecated aliases (see `Deprecated`):
  `playstore_update_latest_release_notes` → `playstore_update_release_notes`,
  `appstore_attach_latest_build` → `appstore_attach_build`.
- Merged-tool parameters: `playstore_update_release_notes` — `versionCode` is optional (omitted = latest release
  on the track) and gains `syncTracks` (only without `versionCode`; the output with `versionCode` is unchanged).
  `appstore_attach_build` — `buildId` is optional (omitted = latest `VALID` build) and gains `minBuildNumber`
  (only without `buildId`).
- **Now require `confirm: true`** (without it they return a dry-run preview): `playstore_submit_release` and
  `playstore_promote_release` (every status, including `draft`), `playstore_delete_product`,
  `playstore_delete_all_images`, `playstore_replace_images`, `playstore_delete_service_account`,
  `playstore_reply_review`, `setup_playstore_connection`, `appstore_delete_screenshot`,
  `appstore_delete_screenshot_set`, `appstore_delete_product`, `appstore_cancel_review`,
  `appstore_remove_review_submission_item`, `appstore_reply_review`, `appstore_add_product_to_review`,
  `firebase_delete_android_app`, `firebase_delete_ios_app`, `firebase_delete_web_app`,
  `jenkins_delete_credential`, `jenkins_create_job`, `jenkins_update_job`, `iam_add_iam_policy_binding`,
  `iam_create_key`, `ci_cancel_build`, `facebook_post_photo`, `facebook_post_multi_photo`, `instagram_post_image`,
  `instagram_post_carousel`, `threads_post`, `threads_post_video`, `threads_post_carousel`.
- `jenkins_create_credential` / `jenkins_upload_keystore` still create a **new** id directly, but replacing an
  **existing** id now needs `confirm: true` (with either the value or the file input style).
- `jenkins_upload_playstore_sa` follows the same rule: it gains a `confirm` parameter and is now classified
  destructive. A new credential id is still created directly, but an id that already exists returns an
  "already exists" dry-run instead of being silently replaced; call again with `confirm: true` to replace it.
- `youtube_upload_video` / `youtube_update_video_privacy` are classified as writes, not destructive (private is
  reversible); public / unlisted still require `confirmVisible: true`.
- Other parameter and output changes:
  - `iam_create_key` returns the key **file path**, keyId and client email — no longer the private key JSON.
  - `android_generate_keystore` returns the **paths** of `upload.jks` and `signing.json` — no longer the passwords
    or the keystore base64.
  - New optional `serviceAccountJsonPath` on `playstore_register_service_account` and
    `playstore_verify_service_account`, and `service_account_json_path` on `jenkins_upload_playstore_sa`
    (files inside `~/.mimi-seed/keys/` only). The `serviceAccountJson` string still works.
  - New optional `keystore_path` on `jenkins_upload_keystore`, and `secret_file` + `secret_field` on
    `jenkins_create_credential` (files inside `~/.mimi-seed/keystores/` only). `keystore_base64` and `secret`
    still work.
  - **Removed** the `ffmpegPath` parameter from `video_render`, `video_validate`, and
    `tiktok_business_plan_video_post` (set `MIMI_SEED_FFMPEG_PATH` instead).
  - `playstore_list_inapp_products` / `playstore_list_subscriptions` return `{ truncated, note, items }` instead
    of a bare array only when the page cap is hit.
  - `packageName` / `package_name(s)` / `bundleId` parameters now reject values that are not valid Android
    package names / iOS bundle ids.

## [0.19.18] - 2026-09-27

### Added

- Link a project to its web-console app (`.mimi-seed-link.json`) and track resumable deployment runs
  (`mimi-seed deploy --prepare-only` / `--resume`). (#32)

### Fixed

- Auth status shows which Google account a grant belongs to, and AdMob account rejections are explained. (#33)

### Tool changes

- None.

## [0.19.17] - 2026-09-21

0.19.15 and 0.19.16 were set in `package.json` but never published to npm, so their changes first shipped here.

### Added

- YouTube channel management and analytics tools; Instagram and Threads browser login. (#29)

### Fixed

- Partial store setup is reported as partial instead of looking complete; provider dependencies upgraded. (#30)
- CI publishes to npm with trusted publishing (OIDC) instead of a long-lived token. (#31)
- Existing store review submissions are reused, and completed releases are replaced rather than duplicated.
- Google Ads cost reports restored; malformed report responses are rejected and diagnostics preserved.

### Tool changes

- Added: `youtube_get_channel`, `youtube_list_videos`, `youtube_get_analytics_report`,
  `youtube_update_video_metadata`, `youtube_set_thumbnail`, `youtube_schedule_video`, `youtube_list_comments`,
  `youtube_list_comment_replies`, `youtube_reply_comment`, `youtube_get_content_insights`.

## [0.19.14] - 2026-09-10

### Added

- Isolated Google channel profiles for YouTube publishing.

### Fixed

- Google Ads reporting compatibility. (#27)

### Tool changes

- None.

## [0.19.13] - 2026-09-07

### Changed

- Release Doctor activation improvements. (#26)

### Tool changes

- None.
