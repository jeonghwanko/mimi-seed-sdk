# Architecture — the codebase spine

> ★ Ontology core. How the two packages, the MCP server, and the tool-registration pattern fit together. For the
> full tool list see [[tool-catalog]]; for credentials see [[auth-credentials]]; for the CLI see [[cli-deploy]].
>
> SSOT: `packages/mcp-server/src/index.ts`, `packages/mcp-server/src/registers/*.ts`,
> `packages/cli/src/index.ts`, the two `package.json` files.

## Two packages, one monorepo

```
mimi-seed-sdk/
├─ packages/
│  ├─ cli/          → npm "mimi-seed"            (build: tsup,  node >=18)
│  └─ mcp-server/   → npm "@yoonion/mimi-seed-mcp" (build: tsc, node >=20)
├─ skills/          → 4 Claude Code / Codex skills   ([[skills-plugins]])
├─ .claude-plugin/ .codex-plugin/ .mcp.json          (plugin + MCP registration)
└─ docs/           → agent-guide.md + domain/ (this ontology)
```

| | `packages/cli` | `packages/mcp-server` |
|---|---|---|
| npm name | `mimi-seed` | `@yoonion/mimi-seed-mcp` |
| version | 0.4.x | 0.6.x |
| build | **tsup** (esbuild bundle) | **tsc** (plain `dist/`) |
| node | >=18 | >=20 |
| role | local/CI orchestration + remote-MCP onboarding | the 150+-tool stdio MCP that hits Google/Apple APIs |
| key deps | `@anthropic-ai/sdk`, `kleur`, `open` | `@modelcontextprotocol/sdk`, `googleapis`, `jose`, `@onesub/providers`, `zod`, `@anthropic-ai/sdk` |

The two packages are independent: the CLI talks to the **remote HTTP MCP** (web console, PAT auth) for
onboarding; the MCP server is the **local stdio MCP** (file-based credentials) that does the heavy store work.
They are not in a parent/child relationship — see the transport split below and [[cli-deploy]].

## The register pattern (the spine to learn first)

Every domain follows the same three-layer shape:

```
mcp-server/src/index.ts
  └─ registerXxxTools(server)            ← registers/<domain>.ts
       server.tool(name, description, zodSchema, handler)
         └─ handler calls <domain>/tools.ts   ← implementation (API calls)
              └─ googleapis / ASC REST client  ← external-apis.md
```

- `index.ts` constructs one `McpServer({ name: 'mimi-seed', version })` (version read at runtime from
  `package.json` so it never drifts), then calls all 17 `registerXxxTools(server)` functions plus
  `registerPrompts(server)` and `registerResources(server)`.
- Each `registers/<domain>.ts` declares tools with `server.tool(...)`. Input validation is **zod** schemas;
  there is no separate schema file.
- Business logic lives in sibling folders (`playstore/tools.ts`, `appstore/tools.ts`, …), not in the register
  file. The register file is the thin "surface"; `tools.ts` is the "engine".
- Errors are translated to human-friendly messages before returning — see the friendly-error layer in
  [[external-apis]].

To **add a tool**: implement it in `<domain>/tools.ts`, register it in `registers/<domain>.ts`, and keep the
count in sync (CONTRIBUTING requires it — see [[pitfalls]]).

## MCP server bootstrap & subcommand dispatch

`mcp-server/src/index.ts` has two run modes off `process.argv[2]`:

1. **No subcommand** → start the MCP server over **stdio** (`StdioServerTransport`). This is what
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
   | `mimi-seed-social-auth` | `social/setup-cli.ts` | Facebook / Instagram (`… facebook` \| `… instagram`) |
   | `mimi-seed-firebase` / `-admob` / `-ga4` | `firebase/cli.ts`, `admob/cli.ts`, `ga4/cli.ts` | admin sub-CLIs |

   These are also declared as `bin` entries in `mcp-server/package.json`, so each is runnable directly via
   `npx -y @yoonion/mimi-seed-mcp <subcommand>`.

   **The `bin` map is a cross-package contract**: the CLI's `mimi-seed setup` / `mimi-seed auth <cred>` shell
   out to these names (`cli/src/mcp-bin.ts`), and a CLI test asserts every bin the credential registry references
   actually exists here. The bins own **writing + validating** credentials so that a second, drifting writer never
   appears in the CLI ([[cli-deploy]], [[pitfalls]]). The social/Facebook/Instagram *validation* itself is shared
   with the MCP tools via `facebook/setup.ts` and `instagram/setup.ts` — one implementation, two entry points.

## Bootstrapping a clone

The repo is **not** an npm workspace — each package installs and builds independently. The root `package.json`
is private and holds only bootstrap scripts: `scripts/install.mjs` walks both packages (`npm install` → `npm run
build` → optional `npm link`) and can register the from-source server with `claude mcp add mimi-seed-dev`. The
`mimi-seed-install` skill is a thin wrapper so an agent can do it from a prompt. See
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

- **Resources** — `mimi-seed://auth/status` (Google OAuth freshness as JSON) and `mimi-seed://agent/guide`
  (the agent role definition).
- **Prompts → slash commands** — `deploy`, `health`, `review-inbox`, surfaced in MCP clients as
  `/mimi-seed:deploy`, `/mimi-seed:health`, `/mimi-seed:review-inbox`. More in [[skills-plugins]].

## Build & module conventions

- **ESM everywhere** (`"type": "module"`); imports use `.js` specifiers even from `.ts` sources (NodeNext).
- Tool names: `snake_case` (`playstore_get_app`). Files: `kebab-case`. Domain folders: lowercase.
- MCP server builds with `tsc` to `dist/`; the CLI bundles with `tsup`. Both publish only `dist` + `LICENSE`
  and test with `vitest`. Verify a change with `npm run build && npm test` **inside the changed package**.
