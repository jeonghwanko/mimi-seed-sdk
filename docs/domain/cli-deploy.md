# CLI & deploy pipeline

> The `mimi-seed` CLI (`packages/cli`): command topology, app detection, the init handshake, and the deploy
> flow. The CLI is the *onboarding + orchestration* layer; the heavy store work is the MCP server's job
> ([[architecture]], [[tool-catalog]]).
>
> SSOT: `packages/cli/src/index.ts` (router) and the per-command modules it imports.

## Commands

Routed by `main()` in `cli/src/index.ts`:

| Command | Module | What it does |
|---|---|---|
| `init` | `index.ts` (`cmdInit`) | detect app → browser PAT handshake → register apps → scaffold project context files |
| `status` | `index.ts` (`cmdStatus`) | show connection + `list_apps` via the remote MCP |
| `auth` | `auth.ts` | local auth: Google OAuth / App Store / Play / BigQuery |
| `firebase` / `admob` / `ga4` | `cloud.ts` | create/list Firebase apps, AdMob, GA4 properties |
| `doctor` | `doctor.ts` | environment diagnostics (token · Node · Git · project · CI) |
| `check` | `check.ts` | pre-release readiness (`--fail-on-blocker` for CI) |
| `notes` | `notes.ts` | release notes: git log → AI → optional store apply |
| `review` | `review.ts` | AI review-reply draft → optional Play post |
| `deploy` | `deploy.ts` | full pipeline: CI build → check → notes → apply |
| `mcp` | `mcp-config.ts` | print / write Claude Code & Codex MCP registration |
| `restart` | `mcp-restart.ts` | restart a registered MCP server process |
| `logout` | `index.ts` (`cmdLogout`) | delete local `config.json` |

Per-command options are the SSOT in `CMD_USAGE` in `index.ts` (also shown by `mimi-seed <cmd> --help`).

## Environment variables

| Var | Effect |
|---|---|
| `MIMI_SEED_TOKEN` | PAT for headless/CI mode — `init` skips the browser handshake when set |
| `MIMI_SEED_WEB_BASE` | web/remote-MCP base (default `https://mimi-seed.pryzm.gg`; `/api/mcp` is appended) |
| `ANTHROPIC_API_KEY` | enables AI note/reply generation |

## `init` — detection → handshake → scaffold

1. **Detect** (`detect.ts`): `hasAnyProjectSignal()` then `detectHints()` reads Expo (`app.json`), Gradle, and
   `Info.plist`/`pbxproj` to infer `{ name, packageName, bundleId }`.
2. **Handshake** (`handshake.ts`): `awaitHandshake()` opens a localhost callback server, the CLI opens
   `<webBase>/cli/connect?...` in the browser, the user logs in, and a PAT is returned to localhost. (In CI,
   `MIMI_SEED_TOKEN` short-circuits this.)
3. **Persist** (`config.ts`): `writeConfig()` stores the PAT prefix + endpoint in `~/.mimi-seed/config.json`.
4. **Register apps**: `mcpCall()` (`mcp-client.ts`) calls `sync_apps` on the remote MCP with the detected hints.
5. **Scaffold into the *user's* project** (not this SDK repo): `.claude/mimi-seed.md` (Claude Code context),
   `AGENTS.md` (Codex context), and `docs/releases.json` (release-notes SSOT, via
   `release-manifest.ts:ensureReleaseManifest`). Existing files are not overwritten.
6. `--local` additionally runs Google OAuth and prints how to register the **local** stdio MCP
   (`@yoonion/mimi-seed-mcp`), which is separate from the remote one.

## Two MCP endpoints from the CLI's view

- The CLI's `init`/`status` use the **remote HTTP MCP** (`<webBase>/api/mcp`, PAT bearer) for onboarding
  (`sync_apps`, `list_apps`) — a smaller read/diagnostic subset with App Store IAP review-note/review-screenshot writes.
- Real store/cloud work uses the **local stdio MCP** (this repo's 150+ tools, file credentials).
- ⚠️ Some CLI help strings quote an old remote-tool count; treat any hard-coded remote count as potentially
  stale — the authoritative count lives in the web-console repo, not here ([[pitfalls]]).

## `deploy` — the pipeline

`deploy.ts` orchestrates, for `--platform android|ios`:

```
CI build (ci-providers.ts)  →  check (readiness)  →  notes (git → AI)  →  apply to store
```

- CI providers (`ci-providers.ts`) detect/trigger **GitHub Actions or GitLab**; `--ci jenkins|github|gitlab`
  forces one, and `setup-jenkins|setup-github|setup-gitlab` run interactive config. Git range for notes comes
  from `git.ts`.
- `--skip-build` (with `--version-code`) skips CI; `--dry-run` tests the pipeline without writing; `--yes/-y`
  skips the confirm prompt for automation.
- The same outcome is reachable as an **MCP tool sequence** (the `deploy` skill / `/mimi-seed:deploy` prompt) —
  see [[skills-plugins]] and [`../agent-guide.md`](../agent-guide.md) §4. Keep the two paths behaviorally in
  sync.

## Security note (public repo)

The CLI handles PATs and opens auth URLs. When editing it: never log full tokens (the code prints only the
`prefix…`), keep `config.toml`/`config.json` writes at user-readable perms, and keep the localhost callback
restricted to localhost. Don't hard-code real endpoints other than the public `mimi-seed.pryzm.gg` default
already present, and never embed a token in committed code, tests, or docs.
