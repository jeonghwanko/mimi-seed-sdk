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
