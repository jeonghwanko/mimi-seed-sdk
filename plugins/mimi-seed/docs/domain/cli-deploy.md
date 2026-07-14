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
| `setup` | `setup.ts` | ★ guided wizard over **all** credentials — status table, then prompts only for what's missing (idempotent/resumable). `--only` / `--reconnect` / `--fail-on-missing`; **never spawns or prompts when non-interactive** (the setup bins block on stdin, so a CI run would hang forever) |
| `lang` | `lang.ts` | CLI output language (`ko` / `en`) → `~/.mimi-seed/settings.json`. `setup` asks on first run; `MIMI_SEED_LANG` overrides |
| `status` | `index.ts` (`cmdStatus`) | show connection + `list_apps` via the remote MCP |
| `auth` | `auth.ts` | per-credential auth: `login` / `appstore` / `playstore` / `bigquery` / `jenkins` / `ci` / `googleads` / `facebook` / `instagram` — each shells out to the matching `mimi-seed-*-auth` bin (`mcp-bin.ts`) |
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

### Output language

`settings.ts` owns `~/.mimi-seed/settings.json` (`{ lang }`); `i18n.ts` holds the catalogs (`ko` is the source,
`en` must satisfy `typeof ko`, so a missing translation is a **compile error**). `t()` resolves the language at
call time, not module-load time — the wizard asks for a language on its very first prompt and everything after it
is already in that language.

**`runMcpBin` passes `MIMI_SEED_LANG` down to the spawned setup bins**, which resolve it the same way
(`mcp-server/src/lib/lang.ts`). Without that, the wizard would be in English while its child prompts came back in
Korean. The credential registry's human text (`label` / `note` / `obtain`) is `LocalizedText`, read through
`credLabel()` / `credNote()` / `credObtain()`.

Shared onboarding text lives in `i18n.ts`'s `t()`; per-command text lives in the command file itself via
`catalog(ko, en)` (same pattern the mcp-server setup bins use), so `i18n.ts` doesn't grow into a thousand-line
dumping ground. Two things enforce completeness: the **compiler** (`NoInfer` makes a missing English key a build
error) and **`i18n-coverage.test.ts`**, which fails if a user-facing Korean literal never went through a catalog
at all — something the compiler cannot see.

Deliberately **not** translated: MCP tool descriptions (the LLM's interface, not a human's — translating them
moves tool-selection quality for no user benefit), the `agentMd` context file written into the user's project,
and `review.ts`'s sentiment-matching keywords (translating those would break the matching).

### The credential registry — one list, three consumers

`cli/src/credentials.ts` is the **SSOT for what credentials exist**. `doctor`, `auth status --all`, and `setup`
all iterate it; previously `doctor` and `auth` each hand-maintained a 4-row list and neither could see Jenkins,
CI, Google Ads, Facebook, or Instagram at all. Each `CredSpec` carries its `detect()` (pure fs/env, no network),
`fix` command, `obtain` steps (the out-of-band vendor-console knowledge), and a `docsAnchor` into
[`../credentials.md`](../credentials.md).

**Who writes a credential file is a hard rule: exactly one owner per credential.** The CLI does not write
`jenkins.json` / `google-ads.json` / `facebook.json` / `instagram.json` — it shells out to the mcp-server bins,
because the *validation* (probe the server, call the API, refuse to save a bad token) lives there. Duplicating a
writer across the two packages is what produced the Jenkins dual-config bug ([[pitfalls]]). The one exception is
`ci.json`, which the CLI both writes and reads at deploy time.

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
