# Architecture — the codebase spine

> ★ Ontology core. How the two packages, the MCP server, and the tool-registration pattern fit together. For the
> full tool list see [[tool-catalog]]; for credentials see [[auth-credentials]]; for the CLI see [[cli-deploy]].
>
> SSOT: `packages/mcp-server/src/server.ts` (+ `src/index.ts`), `packages/mcp-server/src/registers/**/*.ts`,
> `packages/cli/src/index.ts`, the two published `package.json` files, `packages/core/src/`. Step-by-step
> checklists live in [[recipes]].

## Two packages, one monorepo

```
mimi-seed-sdk/
├─ packages/
│  ├─ cli/          → npm "mimi-seed"            (build: tsup,  node >=18)
│  ├─ mcp-server/   → npm "@yoonion/mimi-seed-mcp" (build: tsc, node >=20)
│  └─ core/         → never published — shared SOURCE compiled into both (see "Shared source" below)
├─ skills/          → Claude Code / Codex skills   ([[skills-plugins]])
├─ .claude-plugin/ .codex-plugin/ .mcp.json          (plugin + MCP registration SSOT)
├─ .agents/plugins/marketplace.json                  (Codex marketplace)
├─ plugins/mimi-seed/                                (generated Codex distribution)
└─ docs/           → agent-guide.md + domain/ (this ontology)
```

| | `packages/cli` | `packages/mcp-server` |
|---|---|---|
| npm name | `mimi-seed` | `@yoonion/mimi-seed-mcp` |
| version | both follow the **root** `package.json` (`npm run version:set`) — never written down here | ← same |
| build | **tsup** (esbuild bundle, **no type-check** — run `npm run typecheck`) | **tsc** (plain `dist/`) |
| node | `.nvmrc` is the floor for both (currently 20); `engines.node` mirrors it | ← same |
| role | local/CI orchestration + remote-MCP onboarding | the 150+-tool stdio MCP that hits Google/Apple APIs |
| key deps | `@anthropic-ai/sdk`, `kleur`, `open` | `@modelcontextprotocol/sdk`, `googleapis`, `jose`, `@onesub/providers`, `zod`, `@anthropic-ai/sdk` |

The two packages are independent: the CLI talks to the **remote HTTP MCP** (web console, PAT auth) for
onboarding; the MCP server is the **local stdio MCP** (file-based credentials) that does the heavy store work.
They are not in a parent/child relationship — see the transport split below and [[cli-deploy]]. They never import
each other; code both need lives in `packages/core` and is compiled into each one.

## The register pattern (the spine to learn first)

Every domain follows the same three-layer shape:

```
mcp-server/src/server.ts   buildServer(version, { env })   ← the single assembly point
  └─ createToolRegistrar(McpServer, manifest, toolsets)     ← lib/tool-registrar.ts
       └─ registerXxxTools(registrar)        ← registers/<domain>.ts
            server.tool(name, description, zodSchema, handler)   (same call shape, registrar underneath)
              └─ McpServer.registerTool(name, { title, description, inputSchema, annotations }, handler)
              └─ handler calls <domain>/tools.ts   ← implementation (API calls)
                   └─ googleapis / ASC REST client  ← external-apis.md
```

- **`server.ts`** — not `index.ts` — constructs the one `McpServer({ name: 'mimi-seed-local', version })`
  (version read at runtime from `package.json` so it never drifts), wraps it in the **tool registrar**, and
  calls every `registerXxxTools(registrar)` plus `registerPrompts(server)` and `registerResources(server)`
  (prompts/resources use `McpServer` directly). A **new register module must be added here**; `index.ts` only
  picks a run mode and hands `buildServer()` a transport. `tool-manifest.test.ts` boots this same function, so
  a module that never got wired shows up as missing tools rather than silence.
- Each `registers/<domain>.ts` (App Store: `registers/appstore/<part>.ts`) declares tools with
  `server.tool(...)` — but `server` is a `ToolRegistrar`, not the SDK's deprecated `McpServer.tool`. Input
  validation is **zod** schemas; there is no separate schema file.

### The tool registrar (`lib/tool-registrar.ts`)

Everything that is policy rather than behavior is attached at registration time from `tool-manifest.json`, so
register files stay thin and no tool can opt out by accident:

| Concern | Manifest input | What the registrar does |
|---|---|---|
| Annotations + title | per-domain `write` / `destructive` / `local` / `idempotent` | `readOnlyHint` (neither list), `destructiveHint` (**D**), `idempotentHint` (reads + listed writes), `openWorldHint` (not `local`); a readable `title` from the name |
| Confirm guard | `destructive`, `ownGate` | every **D** tool gets an injected `confirm` flag; calls without `confirm: true` return a `🛑 DRY-RUN` preview and never reach the handler — no exemptions by argument (draft included). A **D** tool listed in `ownGate` instead keeps its own `confirm` / `confirmPublish` / `confirmVisible` flag, which must cover every destructive path (richer previews, or gating only when an existing resource would be replaced). Boot **throws** if a **D** tool has a confirm-style param without `ownGate`, or `ownGate` without such a param — a partial own gate cannot slip through |
| Toolsets | top-level `toolsets`, `alwaysOn`, `alsoInToolsets` | a tool belongs to its domain plus any `alsoInToolsets` domains (e.g. `youtube_upload_video` → `youtube`); it registers when any membership is included and none is excluded. `MIMI_SEED_TOOLSETS` / `MIMI_SEED_TOOLSETS_EXCLUDE` (resolved by `lib/toolsets.ts`) decide which domains register at all; default is every domain; `auth` + `checks` are always on; `mimi_seed_status` prints the active set |
| Deprecated aliases | top-level `deprecated: { old: new }` | the old name is registered with the canonical schema and handler, description prefixed `[DEPRECATED — use <new>; removed in the next minor release]`; it stays in its domain's `tools` so counts stay coherent |
| Inventory | `domains.<d>.tools` | an unknown name **throws** — the manifest is the complete list |

Why a registrar instead of editing 200+ call sites: the classification has one owner (the manifest, mirrored
by the catalog's **W**/**D** markers and test-enforced), and a new destructive tool is guarded the moment it is
classified — nobody has to remember to hand-write a preview branch.
- Business logic lives in sibling folders (`playstore/tools.ts`, `appstore/tools.ts`, …), not in the register
  file. The register file is the thin "surface"; `tools.ts` is the "engine". The two biggest domains split
  their engine into cohesive modules (`appstore/{client,apps,versions,review-submission,products}.ts`,
  `playstore/{edits,statistics,listing,releases,images,reviews,products,recovery,data-safety,service-account}.ts`)
  and keep `tools.ts` as a re-export barrel, because registers, `checks/*`, and tests import and `vi.mock` that
  path. The App Store **register** layer is split the same way: `registers/appstore.ts` stays the one entry
  `server.ts` calls, and only sequences the `registers/appstore/<part>.ts` modules (`apps`, `versions`,
  `metadata`, `media`, `testflight`, `customer-reviews`, `products`, `review-submission`, `declarations`,
  `reports`). Call order there is the `tools/list` order, so a module that owns non-adjacent tools exports more
  than one register function rather than reordering them. A new App Store tool goes into its part's function,
  not the entry file. File IO (reading a CSV or a key
  file the caller named) belongs to the domain module too — e.g. `playstore/data-safety.ts`,
  `android/playstore-sa.ts`.
- Responses go through `lib/mcp-response.ts`: `jsonResult(value)` for structured output, `textResult(str | lines)`
  for prose, `errorResult(str | lines)` for a pre-call rejection (`isError: true`). Don't hand-write
  `{ content: [{ type: 'text', … }] }` — that wrapper was repeated 250 times and made it impossible to see at a
  glance whether a register file was actually thin. The helpers deliberately stop at joining: whether to keep
  blank lines or drop them with `.filter(Boolean)` is the call site's meaning, so that stays visible where it is
  written.
- Multi-line user-facing prose — troubleshooting trees, next-step checklists, dry-run previews — lives in the
  domain's `messages.ts` (`playstore/`, `appstore/`, `android/`, `jenkins/`) as functions returning lines or
  text, so a register handler reads as "call → format → return".
- Errors are translated to human-friendly messages before returning — see the friendly-error layer in
  [[external-apis]]. A register that wants every call of a domain module translated wraps the module once with
  `lib/wrap-domain.ts` (`wrapDomain(mod, translate)`) instead of a hand-copied `Proxy`.

To **add a tool**: implement it in `<domain>/tools.ts`, register it in `registers/<domain>.ts`, and keep the
manifest + docs in sync — the ordered checklist is [[recipes]] §1, the guards are [[testing]].

## MCP server bootstrap & subcommand dispatch

`mcp-server/src/index.ts` is the executable entry (`bin: mimi-seed-mcp`) and has two run modes off
`process.argv[2]`:

1. **No subcommand** → `buildServer(version)` + `StdioServerTransport`. This is what
   `npx -y @yoonion/mimi-seed-mcp` does when a client spawns it.
2. **A known subcommand** → delegate to a sub-CLI and exit. The `SUBCOMMANDS` map routes setup/admin flows that
   must not hang waiting on stdin:

   | subcommand | module | purpose |
   |---|---|---|
   | `mimi-seed-auth` | `auth/cli.ts` | Google OAuth login |
   | `mimi-seed-playstore-auth` | `auth/playstore-setup-cli.ts` | Play service account setup |
   | `mimi-seed-appstore-auth` | `appstore/setup-cli.ts` | App Store Connect API key setup |
   | `mimi-seed-bigquery-auth` | `auth/bigquery-setup-cli.ts` | BigQuery auth |
   | `mimi-seed-jenkins-auth` | `jenkins/setup-cli.ts` | Jenkins — probes the server before saving |
   | `mimi-seed-googleads-auth` | `googleads/setup-cli.ts` | Google Ads — verifies via a live API call before saving |
   | `mimi-seed-social-auth` | `social/setup-cli.ts` | Facebook / Instagram / Threads (`… facebook` \| `… instagram` \| `… threads`) |
   | `mimi-seed-firebase` / `-admob` / `-ga4` | `firebase/cli.ts`, `admob/cli.ts`, `ga4/cli.ts` | admin sub-CLIs |

   These are also declared as `bin` entries in `mcp-server/package.json`, so each is runnable directly via
   `npx -y @yoonion/mimi-seed-mcp <subcommand>`.

   **The `bin` map is a cross-package contract**: the CLI's `mimi-seed setup` / `mimi-seed auth <cred>` shell
   out to these names (`cli/src/mcp-bin.ts`), and a CLI test asserts every bin the credential registry references
   actually exists here. The bins own **writing + validating** credentials so that a second, drifting writer never
   appears in the CLI ([[cli-deploy]], [[pitfalls]]). The social/Facebook/Instagram/Threads *validation* itself
   is shared with the MCP tools via each domain's `setup.ts` — one implementation, two entry points.

## Bootstrapping a clone

The repo is **not** an npm workspace — each package installs and builds independently (`packages/core` has
nothing to install; each package's build picks it up from the checkout). The root `package.json`
is private and holds only bootstrap scripts: `scripts/install.mjs` walks both packages (`npm install` → `npm run
build` → optional `npm link`) and can register the from-source server with `claude mcp add mimi-seed-dev`. The
`mimi-seed-install` skill is a thin wrapper so an agent can do it from a prompt. The same setup also syncs and
registers the Codex marketplace/plugin; MCP-only registration is not treated as a complete Codex install. See
[`../from-source.md`](../from-source.md).

## Transports — two MCPs, do not conflate

| | Local stdio MCP (**this repo**) | Remote HTTP MCP (web console, other repo) |
|---|---|---|
| transport | stdio (client spawns the process) | Streamable HTTP at `/api/mcp` |
| auth | `~/.mimi-seed/` credentials ([[auth-credentials]]) | PAT bearer token |
| tools | 150+ (full store/cloud surface — exact list: `tool-manifest.json`) | a smaller read/diagnostic subset plus App Store IAP review metadata writes |
| identifier | exposed as `mimi-seed` | also exposed as `mimi-seed` (← the confusion source) |

Both are conventionally *registered* under the key `mimi-seed` (existing installs; new local installs are
documented as `mimi-seed-local`), but since 2026-07 the handshake-level `serverInfo.name` disambiguates:
local stdio = `mimi-seed-local`, web remote = `mimi-seed-web` — and `mimi_seed_status`'s first line
self-identifies. Fallback heuristic: **tool-name prefix + auth method**. The 100+
`playstore_* / appstore_* / firebase_*` deferred tools are the local stdio MCP (this repo). Detail and the
two-repo boundary live in [[pitfalls]]. (The web console's internals are out of scope here — public boundary
only.)

## Resources & prompts (the agent-facing surface)

Registered in `mcp-server/src/resources.ts` and `prompts.ts`:

- **Resources** — `mimi-seed://auth/status` (Google OAuth freshness as JSON), `mimi-seed://agent/guide`
  (the full `docs/agent-guide.md`, served from the committed copy `packages/mcp-server/assets/agent-guide.md`
  — refreshed by `npm run plugin:sync`), and `mimi-seed://tools/catalog` (runtime capability index built
  from `tool-manifest.json` — per-domain `label`/`credential`/`summary`, the `write`/`destructive` lists, and
  deprecated aliases — filtered to the tools this server actually registered under `MIMI_SEED_TOOLSETS`).
- **Prompts → slash commands** — `getting-started`, `deploy`, `health`, `review-inbox`, surfaced in MCP
  clients as `/mimi-seed:<name>`. More in [[skills-plugins]].

## Shared source: `packages/core`

The two published packages never import each other, and neither may depend on an unpublished package — each
must install from npm on its own. Code both of them need therefore lives in **`packages/core`**: private,
dependency-free TypeScript **source** that each package compiles into its own output. It is never published,
never `npm install`ed, and has no build of its own.

| `#core/…` module | What both packages share |
|---|---|
| `checks/{billing,release-doctor,release-doctor-render,lockfile}.ts` | Release Doctor — the MCP bin/tools and `mimi-seed check --local` run the same scanner in-process (`lockfile.ts`: npm/pnpm/Yarn lockfile and repository-root lookups) |
| `project-manifest.ts` | the `.mimi-seed.json` schema + reader (wording of validation errors is passed in by the caller) |
| `lang.ts` | the `MIMI_SEED_LANG` > `settings.json` > `ko` rule, so the wizard and the setup bins it spawns agree |
| `atomic-write.ts` | temp + rename credential writes, incl. the Windows rename-retry schedule |
| `ai.ts` | the Claude model id and the AI generators' language-independent contract (classifier keywords, tone / sentiment keys, `max_tokens`) |
| `http-errors.ts` | the fetch wrappers' token-stripping endpoint label and timeout detection |
| `ci.ts`, `jenkins.ts` | the `ci.json` / `jenkins.json` shapes and the CI REST base-URL rules |

**How each build consumes it.** Both packages import it as `#core/<path>.js`:

- **cli** — `tsconfig.json` `paths` maps `#core/*` to `../core/src/*`. tsup (esbuild), tsx and `tsc` all read
  that mapping, so the bundle *contains* the core code and the published `dist/` has no `#core` specifier left.
- **mcp-server** — `npm run build` is `npm run clean && tsc -p tsconfig.core.json && tsc -p tsconfig.build.json`:
  it deletes `dist/` (so a module removed from core never lingers in `dist/core/` and ships), compiles core into
  **`dist/core/`** (emitted as ESM because `packages/core/package.json` says `"type": "module"`), then builds the
  server against the `.d.ts` files that produced — `tsconfig.build.json` empties `paths` so `#core/*` resolves
  through `imports`, since core's source sits outside its `rootDir: src`. At runtime Node resolves `#core/*` through the
  package's own `"imports": { "#core/*": "./dist/core/*" }`, which works identically from a checkout and from an
  installed tarball. Every `bin` path and every other `dist/` entry point is unchanged.
- **Tooling reads the source, not a build.** mcp-server's plain `tsconfig.json` is the editor / typecheck / tsx
  config: `noEmit`, tests included, and `paths` mapping `#core/*` to the core source — so `npx tsx src/…`,
  `tsc -p tsconfig.json`, and go-to-definition work before any build and never land on a stale `dist/core`
  `.d.ts` (`tsconfig.lint.json` just extends it, matching the CLI's lint entry point). Emit settings live only in
  `tsconfig.build.json` / `tsconfig.core.json`. Both `vitest.config.ts` files do the same mapping with a
  `resolve.alias`.
- **Checked where it is consumed.** Each package's typecheck covers the core files it imports; mcp-server's
  `npm test` additionally typechecks all of core (`tsc -p ../core`) and lints it (`eslint . ../core` — core's
  `eslint.config.js` borrows mcp-server's config and toolchain). Core has no tests or `node_modules` of its own:
  the tests for a core module stay in the package that has always tested it, importing `#core/…`.

**Why this shape and not another.** A published `@mimi-seed/core` package would add a third release to
coordinate for code nobody installs directly. An npm workspace would change how both packages install and lock.
Switching mcp-server to a bundler would rewrite `dist/` (a dozen `bin` entry points, the deep imports of
`scripts/googleads-report.mjs`, `package-bin-contract.test.ts`). tsc project references would need a separate
core `outDir` copied into mcp-server's `dist/`. The chosen shape adds one `imports` entry and splits mcp-server's tsconfig into editor (`tsconfig.json`) and emit
(`tsconfig.build.json`, `tsconfig.core.json`) configs, and
the only change to the published MCP tarball is the new `dist/core/` directory (the three Release Doctor files
and a few `lib/` modules moved there from their old paths).

**Rules** (enforced by `core-boundary.test.ts`, [[testing]]):

1. Core imports only `node:` builtins and its own files (`./x.js`). An npm import would compile but fail after
   install, because core has no `node_modules` of its own.
2. Core never calls `fetch` — timeout/retry policy differs by package and lives in each `lib/http.ts`.
3. The packages reach core only through `#core/<path>.js`, never a relative `../../core/src/…` path (that
   would point outside mcp-server's published `dist/`).
4. Core code must satisfy **both** compilers (mcp-server's NodeNext + the CLI's Bundler resolution, both
   strict): `.js` import specifiers, no package-specific helpers such as the CLI's `catalog()`.

**What stays duplicated on purpose.** Only code whose behavior differs by package: the two `fetch` wrappers
(mcp-server: 60 s + 429/5xx retry; CLI: 30 s, no retry, localized errors), the CI clients (request shapes,
polling, error text), and the AI generators' prompt text — the CLI runs it through `catalog(ko, en)` so an
English CLI user gets English tone guidance, and the two release-note generators return different JSON shapes
(`tones[]` vs flat keys). What must not diverge between those copies is already in core.

To **add to core**: move the file into `packages/core/src/` (keep its tests where they are and point them at
`#core/…`), switch every importer in both packages to `#core/<path>.js`, and run `npm run build && npm test` in
**both** packages — see [[recipes]].

## Build & module conventions

- **ESM everywhere** (`"type": "module"`); imports use `.js` specifiers even from `.ts` sources (NodeNext).
- Tool names: `snake_case` (`playstore_get_app`). Files: `kebab-case`. Domain folders: lowercase.
- MCP server builds with `tsc` to `dist/` (core first, into `dist/core/`); the CLI bundles with `tsup`
  (core included). The CLI publishes `dist` + `LICENSE`;
  the MCP server additionally ships `assets/` (the served agent guide) and `tool-manifest.json` (the catalog
  resource's data). Both test with `vitest`. Verify a change with `npm run build && npm test` **inside the
  changed package**.
