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
- The MCP server registers **147 tools** across **17 domain modules** — Play Store, App Store Connect, Firebase,
  AdMob, Google Cloud IAM, BigQuery, GA4, Search Console, Google Ads, CI (GitHub/GitLab), Jenkins credentials,
  Facebook, Instagram, Android signing, AI, Auth, and Checks. (Public READMEs round this to "110+".)
- It drives Google / Apple APIs **directly** using local credentials under `~/.mimi-seed/`. It manages
  metadata, store releases, and CI/Jenkins *credentials* — it does **not** compile `.aab`/`.ipa` binaries.
- The private web console is a **separate repo** with a different transport and auth model. The boundary and the
  drift rules live in [[pitfalls]] and [[architecture]].

## SSOT layering (code is the source of truth)

This ontology sits **on top of** the code. When in doubt, the code wins:

```
docs/domain/*           why · how · pitfalls          ← you are here
  └─ registers/<domain>.ts   tool surface (server.tool name+schema+handler)
       └─ <domain>/tools.ts  implementation (API calls)
            └─ googleapis / App Store Connect REST clients
```

## Documents

Each file lives under `docs/domain/`. Read the one that matches your task first.

| File | Covers | Keywords |
|------|--------|----------|
| [architecture.md](architecture.md) | ★ **ontology core** — two packages, the `registers/<domain>.ts → tools.ts → API client` pattern, MCP bootstrap + `SUBCOMMANDS` dispatch, stdio vs HTTP, builds (tsup/tsc), resources & prompts | packages, monorepo, register pattern, server.tool, bootstrap, subcommand, stdio, transport, build |
| [tool-catalog.md](tool-catalog.md) | The 147 tools by domain → register file → tool group, with write/destructive markers and cross-named-tool quirks | tools, catalog, domains, playstore_, appstore_, firebase_, counts, destructive |
| [auth-credentials.md](auth-credentials.md) | `~/.mimi-seed/` credential map (locations & roles only), OAuth vs ASC JWT vs Play SA, per-package SA resolution, setup sub-CLIs, `ANTHROPIC_API_KEY` | auth, credentials, tokens.json, appstore.json, service account, per-package, JWT, OAuth |
| [external-apis.md](external-apis.md) | What each domain talks to (`googleapis` surfaces, ASC REST+JWT, `@onesub/providers`, Anthropic) and the friendly-error translation layer | googleapis, App Store Connect, jose, friendly error, google-errors, 403, providers |
| [cli-deploy.md](cli-deploy.md) | CLI command topology, app detection, CI providers, the deploy pipeline data flow, MCP registration, init handshake, release manifest | cli, init, deploy, detect, ci-providers, handshake, mcp-config, releases.json |
| [skills-plugins.md](skills-plugins.md) | The 4 skills, plugin manifests (`.claude-plugin` vs `.codex-plugin`), multi-client surface differences, slash commands & MCP resources | skills, plugin, codex, slash command, resources, prompts, multi-client |
| [pitfalls.md](pitfalls.md) | Validated SDK-side traps — deferred tools, draft-app track, 403≠permission, Play↔Console overwrite, CI≠Jenkins, two-repo drift, tool-count sync | pitfalls, gotchas, deferred, draft app, 403, drift, two repos, tool count |

## Read X before Y

```
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

_This ontology is manually maintained against the code. When a register, credential path, or command changes,
update the matching `docs/domain/*` file. It is a **public repo**: describe structure and behavior only — never
secret values, real identifiers, or private web-console internals (see the security note in each doc)._
