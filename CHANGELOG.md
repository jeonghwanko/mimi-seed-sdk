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

- `mimi-seed doctor --json` prints the whole diagnosis as one machine-readable report.
- CI runs both packages' test suites on Windows (Node 22) in addition to Linux (Node 20 and 22).
- `CHANGELOG.md` (this file), with a `Tool changes` convention for MCP tool additions, renames, and removals.

### Changed

- Releases publish only on a `v*` tag push (the tag must equal the root version and point at a commit on `main`);
  pushing to `main` runs tests only. Both packages publish from one job that runs only after every test leg
  passes, mcp-server first, so a failed mcp-server publish stops the cli publish instead of leaving a lone cli
  release.
- `mimi-seed doctor` exits with code 1 when any ✗ check fails, so it can gate CI. The Mimi Seed cloud token is
  only treated as required when remote use is configured (`MIMI_SEED_TOKEN`, `MIMI_SEED_WEB_BASE`, or a
  `.mimi-seed-link.json` in the project); local-stdio-only setups now get a warning instead of a failure. App
  Store Connect only fails when the project has an iOS app, so Android-only projects pass.
- When a setup binary is not on `PATH`, the CLI runs `npx @yoonion/mimi-seed-mcp@<its own version>` instead of
  whatever npm `latest` is, so a CLI is never paired with a mismatched MCP server. A CLI run from a source
  checkout (whose version may not be on npm yet) uses `@latest` and says so.
- Remote MCP calls from the CLI wait up to 2 minutes, and store writes (`apply_release_notes`,
  `playstore_reply_review`, `sync_apps`) up to 5 minutes, so a slow write is not cut off with an unknown outcome.
- The CLI's command help moved to `packages/cli/src/help.ts` and `mimi-seed init` to `packages/cli/src/init.ts`
  (internal refactor; no behavior change).

### Fixed

- Every outbound HTTP call in the CLI (GitHub, GitLab, Jenkins, the web console, telemetry) now has a timeout, so
  a hung server can no longer freeze `deploy`, `doctor`, or `init` indefinitely. A timeout while a response is
  still streaming shows the same readable message instead of a raw `AbortError`.
- Jenkins queue and build-status lookups failed for a controller URL saved with a trailing slash; all Jenkins
  calls now normalize the URL the same way.
- The CLI's credential files (`ci.json`, `config.json`, `telemetry.json`, and the legacy Jenkins migration) are
  written atomically with `0600` permissions; an interrupted write can no longer leave a truncated file or a
  briefly world-readable token.
- `doctor` no longer aborts when the Mimi Seed server is unreachable; it reports one failed check and finishes.

### Tool changes

- None.

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
