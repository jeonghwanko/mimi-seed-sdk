# Mimi Seed SDK — Domain Ontology (index)

> Structural knowledge base for developers working **inside this repo**: what exists, how it is wired, and
> why. This index is the only file auto-loaded (via the root `CLAUDE.md @import`). The linked documents are
> **not** auto-loaded — `Read` the relevant one before starting a task.
>
> For *how an agent should call* the tools at runtime (deferred-tool loading, call order, safety, `select:`
> batches), see [`../agent-guide.md`](../agent-guide.md). This ontology is the **why/how-it-is-built** layer and
> deliberately does not duplicate that operational contract.

## What the SDK is

- Public developer tooling for app launch ops: a **CLI** (`mimi-seed`) + a **local stdio MCP server**
  (`@yoonion/mimi-seed-mcp`) in a two-package monorepo under `packages/`.
- The MCP server registers **150+ tools** across the domain modules under `src/registers/` (exact inventory:
  `packages/mcp-server/tool-manifest.json`, test-enforced) — Play Store, App Store Connect, Firebase,
  AdMob, Google Cloud IAM, BigQuery, GA4, Search Console, Google Ads, CI (GitHub/GitLab), Jenkins credentials,
  Facebook, Instagram, Threads, Android signing, video production (incl. YouTube publishing), AI, Auth, and
  Checks. (Prose docs use the "150+" floor; only the manifest and the blocks generated from it — [[tool-catalog]]
  and the README tool tables — carry exact counts.)
- It drives Google / Apple APIs **directly** using local credentials under `~/.mimi-seed/`. It manages
  metadata, store releases, and CI/Jenkins *credentials* — it does **not** compile `.aab`/`.ipa` binaries.
- The private web console is a **separate repo** with a different transport and auth model. The boundary and the
  drift rules live in [[pitfalls]] and [[architecture]].

## SSOT layering (code is the source of truth)

This ontology sits **on top of** the code. When in doubt, the code wins:

```
docs/domain/*           why · how · pitfalls          ← you are here
  └─ src/server.ts           buildServer() — the one place register modules are wired
       └─ registers/<domain>.ts   tool surface (server.tool name+schema+handler)
            └─ <domain>/tools.ts  implementation (API calls)
                 └─ googleapis / App Store Connect REST clients
```

Notation: `[[name]]` in these documents means `docs/domain/name.md`.

## Documents

Each file lives under `docs/domain/`. Read the one that matches your task first.

| File | Covers | Keywords |
|------|--------|----------|
| [architecture.md](architecture.md) | ★ **ontology core** — two packages, the `registers/<domain>.ts → tools.ts → API client` pattern, MCP bootstrap + `SUBCOMMANDS` dispatch, stdio vs HTTP, builds (tsup/tsc), resources & prompts | packages, monorepo, register pattern, server.tool, bootstrap, subcommand, stdio, transport, build |
| [tool-catalog.md](tool-catalog.md) | The tools by domain → register file → tool group, with write/destructive markers and cross-named-tool quirks | tools, catalog, domains, playstore_, appstore_, firebase_, counts, destructive |
| [auth-credentials.md](auth-credentials.md) | `~/.mimi-seed/` credential map (locations & roles only), OAuth vs ASC JWT vs Play SA, per-package SA resolution, setup sub-CLIs, media API environment keys | auth, credentials, tokens.json, appstore.json, service account, per-package, JWT, OAuth, video |
| [external-apis.md](external-apis.md) | What each domain talks to (`googleapis` surfaces, ASC REST+JWT, `@onesub/providers`, Anthropic) and the friendly-error translation layer | googleapis, App Store Connect, jose, friendly error, google-errors, 403, providers |
| [cli-deploy.md](cli-deploy.md) | CLI command topology, app detection, CI providers, the deploy pipeline data flow, MCP registration, init handshake, release manifest | cli, init, deploy, detect, ci-providers, handshake, mcp-config, releases.json |
| [skills-plugins.md](skills-plugins.md) | The 8 skills, plugin manifests (`.claude-plugin` vs `.codex-plugin`), multi-client surface differences, slash commands & MCP resources | skills, plugin, codex, slash command, resources, prompts, multi-client |
| [pitfalls.md](pitfalls.md) | Validated SDK-side traps — deferred tools, draft-app track, 403≠permission, Play↔Console overwrite, CI≠Jenkins, two-repo drift, tool-count sync | pitfalls, gotchas, deferred, draft app, 403, drift, two repos, tool count |
| [recipes.md](recipes.md) | ★ **do this task** — ordered file-by-file checklists: add a tool, add a credential, add a CLI command, ship a doc, add a skill, cut a release, PR gate | how to, checklist, add tool, add credential, add command, plugin sync, release, PR |
| [testing.md](testing.md) | Which guard owns which fact, what a red test is really telling you, how to run one file, what is *not* enforced | tests, vitest, drift, guard, plugin:check, CI, failure |

## Read X before Y

```
# "How do I actually do this?" — ordered checklist + the guard that catches a miss
Read: docs/domain/recipes.md

# A test went red, or you want to know what will catch you
Read: docs/domain/testing.md

# Changing the package layout, the register pattern, or the server bootstrap
Read: docs/domain/architecture.md

# Adding / renaming a tool, or finding which register file owns a tool
Read: docs/domain/tool-catalog.md

# Anything touching credentials, OAuth, service accounts, JWT
Read: docs/domain/auth-credentials.md

# Wiring a new Google/Apple API call or error handling
Read: docs/domain/external-apis.md

# Working on the CLI commands or the deploy pipeline
Read: docs/domain/cli-deploy.md

# Editing skills, plugin manifests, or slash commands
Read: docs/domain/skills-plugins.md

# Stuck, or "why was it built this way?"
Read: docs/domain/pitfalls.md
```

---

## What this folder manages (scope)

**In scope** — facts that live *between* files and cannot be recovered by reading any single one:
cross-module wiring, why a thing is built the way it is, and traps that cost someone an hour.

**Out of scope** — anything one file already states authoritatively. Don't mirror it here; link to it:

| Don't put here | It already lives in |
|---|---|
| A tool's parameters / schema | `registers/<domain>.ts` (the `server.tool(…)` call) |
| A CLI command's flags | the `usage.<command>` entries of the `catalog(…)` in `cli/src/help.ts` (what `mimi-seed <cmd> --help` prints) |
| How an agent should *call* tools at runtime | [`../agent-guide.md`](../agent-guide.md) |
| Install / usage instructions for end users | `README.md` |
| How a **user obtains** a credential (vendor consoles) | [`../credentials.md`](../credentials.md) |
| What a user does about an **error** | [`../troubleshooting.md`](../troubleshooting.md) |
| Clone → build → link → run from a checkout | [`../from-source.md`](../from-source.md) |
| Package or plugin **version numbers** | the **root** `package.json` (`npm run version:set`) — it is the SDK's single version and the two packages + two plugin manifests follow it. Versions rot on every release; never write one into this folder |
| Secret values, real identifiers, console internals | nowhere — this is a public repo |

## Fact → SSOT → mirror → who enforces it

The ontology is a *mirror* of the code, so every mirrored fact can drift. This is the drift map:

| Fact | SSOT (code) | Mirrored in | Enforced by |
|---|---|---|---|
| Tool names & inventory, **W** / **D** classification, deprecated aliases | `tool-manifest.json` | [tool-catalog.md](tool-catalog.md) — **generated** by `scripts/gen-docs.mjs` (labels, notes, grouping from `scripts/docs-spec.mjs`) | ✅ `tool-manifest.test.ts` (manifest ↔ live server) + `gen-docs --check` (`plugin:check` and `docs-drift.test.ts`: a stale generated block fails) |
| Exact tool **and domain** counts | `tool-manifest.json` | [tool-catalog.md](tool-catalog.md) + the README tool tables **only** — both **generated** | ✅ `gen-docs --check`; `docs-drift.test.ts` also rejects a hard-coded `<n> domains` / `<n> tools` / `<n>개 영역` anywhere else in the contributor and agent docs, so prose must say "150+" or name the domains |
| README tool tables (counts, labels, highlights, heading domain count) | `tool-manifest.json` (counts, Korean `label`) + `scripts/docs-spec.mjs` (English label, highlights) | `README.md`, `README.ko.md`, `packages/mcp-server/README.md` — **generated** | ✅ `gen-docs --check` |
| Credential files & roles | `src/*/config.ts`, `src/auth/*` | [auth-credentials.md](auth-credentials.md) | ⚠️ manual |
| Published MCP executable entrypoints | `packages/mcp-server/package.json` `bin` | matching `src/**/*.ts` entrypoints emitted under `dist/` | ✅ `package-bin-contract.test.ts` — every bin must map to an existing source file and `dist` must ship |
| CLI commands | `cli/src/index.ts` router | [cli-deploy.md](cli-deploy.md) | ⚠️ manual |
| Skills, prompts, resources | `skills/*/SKILL.md`, `prompts.ts`, `resources.ts` | [skills-plugins.md](skills-plugins.md) | ⚠️ manual (incl. the skill count in the table above) |
| Tool discoverability (`select:` batches) | `tool-manifest.json` + `scripts/docs-spec.mjs` `batches` | [`../agent-guide.md`](../agent-guide.md) §0 — **generated**; a new tool joins the batch that owns its domain (`fallbackFor`) | ✅ `gen-docs` refuses a domain no batch owns; `docs-drift.test.ts` — every registered tool (except deprecated aliases) must sit in ≥1 batch, and no batch may name a tool that doesn't exist or a deprecated alias |
| Tool classification (read / **W** / **D**, local, idempotent) → MCP annotations + confirm guard | `tool-manifest.json` (`write` / `destructive` / `local` / `idempotent`) | [tool-catalog.md](tool-catalog.md) **W**/**D** markers — **generated** | ✅ `gen-docs --check` (via `plugin:check` + `docs-drift.test.ts`: markers are rendered from the lists) + `tool-manifest.test.ts` (live annotations) + `destructive-confirm.test.ts` (every **D** tool previews without `confirm`) |
| Agent guide served over MCP | `docs/agent-guide.md` | `packages/mcp-server/assets/agent-guide.md` (refreshed by `npm run plugin:sync`) | ✅ `prompts-resources.test.ts` — byte equality |
| Auth error codes & their recovery | `mcp-server/src/auth/errors.ts` (`AuthErrorCode`) | [`../troubleshooting.md`](../troubleshooting.md) + `.ko` | ✅ `docs-onboarding.test.ts` — add a code without a recovery entry and CI fails |
| Credential list & wizard deep-links | `cli/src/credentials.ts` (the registry) | [`../credentials.md`](../credentials.md) + `.ko` | ✅ anchors + EN/KO parity tested; the vendor click-paths themselves are ⚠️ manual (Apple/Meta/Google reorganize their consoles on their own schedule) |
| Node floor | `.nvmrc` | both `package.json`s, READMEs, `from-source.md` | ✅ `docs-onboarding.test.ts` |
| Release version | root `package.json` | `packages/*/package.json` (+ their lockfiles), `.claude-plugin/`, `.codex-plugin/`, `plugins/mimi-seed/` | ✅ `version-sync.test.ts` + `npm run plugin:check` |
| Codex marketplace distribution | root `.codex-plugin/`, `.mcp.json`, `skills/`, `docs/`, `LICENSE` | `.agents/plugins/marketplace.json`, `plugins/mimi-seed/` | ✅ `npm run plugin:check` — file drift and marketplace contract |
| Release Doctor bundled source | `mcp-server/src/checks/{billing,release-doctor,release-doctor-render}.ts` | matching `cli/src/checks/` paths | ✅ `sync-release-doctor.mjs --check` via `npm run plugin:check`; refresh only with `npm run release-doctor:sync` |
| CLI output strings (ko/en) | `cli/src/i18n.ts` — `t()` for shared onboarding text, `catalog(ko, en)` for per-command text | each command file | ✅ **two** guards: the compiler (`catalog<T>(ko, en: NoInfer<T>)` — a missing English key fails the build) **and** `i18n-coverage.test.ts`, which fails if any user-facing Hangul literal sits outside a `ko` catalog. The compiler alone can't see a hardcoded Korean string that never went through a catalog |
| Outbound HTTP has a timeout | `mcp-server/src/lib/http.ts` | every provider client (`appstore/`, `jenkins/`, `ci/`, `facebook/`, `instagram/`, `threads/`, `googleads/`, `video/`, `remote-sync.ts`, `auth/constants.ts`) | ✅ `http-timeout.test.ts` — rejects a raw `fetch(` anywhere in `src/` outside `lib/http.ts`. Node's fetch has no default response timeout, and a hung socket blocks a stdio tool call with no way for the client to cancel |
| CLI outbound HTTP has a timeout | `cli/src/lib/http.ts` (a deliberate copy — the packages don't import each other) | every CLI caller (`ci-providers.ts`, `deploy.ts`, `deploy-runs.ts`, `mcp-client.ts`, `project-link.ts`, `telemetry.ts`) | ✅ `cli/…/http-timeout.test.ts` — same raw-`fetch(` ban over the CLI's `src/`. A hung CI poll or web call otherwise freezes `deploy` / `doctor` / `init` with no message |
| CLI credential writes are atomic + 0600 | `cli/src/lib/atomic-write.ts` (same semantics as the mcp-server copy) | `ci-providers.ts` (`ci.json`), `config.ts` (`config.json`), `jenkins-config.ts` (legacy migration), `telemetry.ts`; `settings.ts` atomic without `0600` | ✅ `cli/…/atomic-write.test.ts` — writer list complete, no raw `writeFile` in a module that touches `~/.mimi-seed`, and no CLI writer names an mcp-server-owned credential file (one writer per credential) |
| Credential writes are atomic + 0600 | `mcp-server/src/lib/atomic-write.ts` | the credential writers listed in the guard | ✅ `atomic-write.test.ts` — the writer list must stay complete and none may use raw `writeFileSync`. A torn write leaves truncated JSON that every reader swallows as "not authenticated" |
| `.mimi-seed.json` schema | *neither* — it is hand-duplicated on purpose (cli does not depend on mcp-server) | `cli/src/project-manifest.ts` ↔ `mcp-server/src/lib/project-manifest.ts` | ✅ `manifest-schema-parity.test.ts` — filename, `SocialPlatform`, `ManifestServiceId`, interface fields, profile-id pattern, and shared exports must match |
| Claude model id | `mcp-server/src/ai/client.ts` (`AI_MODEL`) + `cli/src/ai-model.ts` (`CLI_AI_MODEL`) | `ai/*`, `video/*`, `cli/{notes,review}.ts` | ✅ `ai-model-parity.test.ts` — the two constants must be equal and no literal may survive elsewhere |
| AI generator contract (shared, language-independent) | *neither* — the CLI localizes its prompts via `catalog`, so the duplication is deliberate | `cli/src/{review,notes}.ts` ↔ `mcp-server/src/ai/{review,notes}.ts` | ✅ `ai-parity.test.ts` — sentiment keywords, tone/sentiment key sets, and `max_tokens` must match |
| googleapis calls have a timeout | `mcp-server/src/lib/google-timeouts.ts` (via `google._options` in `lib/googleapis-lite.ts`) | every `google.<api>(…)` call; media uploads pass `mediaUploadOptions()` (3 h, `MIMI_SEED_UPLOAD_TIMEOUT_MS`) | ✅ `googleapis-timeout.test.ts` — asserts the timeout reaches the real request options |
| Package / bundle id params are validated | `mcp-server/src/lib/package-name.ts` | every register param named like `packageName` / `package_name(s)` / `bundleId`; re-checked at the file boundary in `auth/playstore-auth.ts` | ✅ `security-package-param.test.ts` — boots the server and calls each such tool with `../tokens` |
| Caller ids in REST paths are encoded | `mcp-server/src/lib/url-path.ts` (`encodePathSegment`) | raw-REST provider clients (`appstore/`, `facebook/`, `instagram/`, `threads/`, `googleads/`, `ci/`, …) | ✅ `path-encoding.test.ts` — rejects an unencoded `/${…}` segment outside a documented allowlist |
| No private identifiers in a public repo | — (policy) | `packages/*/src`, `docs/`, `skills/` | ✅ `public-repo-hygiene.test.ts` — bans leaked project / job / GA4 / service-account identifiers, including inside `describe()` strings and default values |

## Update triggers

| When you… | Also update |
|---|---|
| add / rename / delete a tool | `tool-manifest.json`, then `npm run plugin:sync` — [tool-catalog.md](tool-catalog.md), the README tool tables, and the agent-guide §0 batches are regenerated from it; touch `scripts/docs-spec.mjs` only for notes, batch placement, or a new domain ([recipes.md](recipes.md) §1) |
| want a different label, per-tool note, README highlight, or `select:` batch row | `scripts/docs-spec.mjs`, then `npm run plugin:sync` — never the text inside a `<!-- generated:… -->` block |
| add a credential file or auth flow | [auth-credentials.md](auth-credentials.md) |
| add a CLI command or change the deploy pipeline | [cli-deploy.md](cli-deploy.md) |
| add a skill, prompt, or plugin surface | [skills-plugins.md](skills-plugins.md) + the skill count in this index + `npm run plugin:sync` |
| wire a new Google/Apple API or error path | [external-apis.md](external-apis.md) |
| change **any** file under `docs/`, `skills/`, `.codex-plugin/`, `.mcp.json`, `LICENSE` | `npm run plugin:sync`, then commit the regenerated `plugins/mimi-seed/` |
| add or move a guard (test / script `--check`) | the guard table in [testing.md](testing.md) + the "Enforced by" column above |
| change the steps of a common task | [recipes.md](recipes.md) — the checklist agents follow |
| lose an hour to a non-obvious trap | [pitfalls.md](pitfalls.md) — that is what it is for |

It is a **public repo**: describe structure and behavior only — never secret values, real identifiers, or
private web-console internals (see the security note in each doc).
