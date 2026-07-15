# Mimi Seed SDK — Codex contributor guide

This repository is the public developer-tooling source of truth for Mimi Seed. It contains two independently
built npm packages: the `mimi-seed` CLI and the `@yoonion/mimi-seed-mcp` local stdio MCP server.

## Start here

Before non-trivial work, read [`docs/domain/_index.md`](docs/domain/_index.md). It routes each task to the
smallest relevant structural document and records which files are authoritative. Do not load the whole domain
folder by default.

Use the following task map after reading the index:

| Task | Read first |
|---|---|
| Package layout, MCP bootstrap, register pattern | [`docs/domain/architecture.md`](docs/domain/architecture.md) |
| Add, rename, or debug an MCP tool | [`docs/domain/tool-catalog.md`](docs/domain/tool-catalog.md) |
| Credentials, OAuth, service accounts, JWT | [`docs/domain/auth-credentials.md`](docs/domain/auth-credentials.md) |
| Google or Apple API calls and error translation | [`docs/domain/external-apis.md`](docs/domain/external-apis.md) |
| CLI commands, init, setup, deploy | [`docs/domain/cli-deploy.md`](docs/domain/cli-deploy.md) |
| Skills, manifests, or Codex plugin packaging | [`docs/domain/skills-plugins.md`](docs/domain/skills-plugins.md) |
| Unexpected behavior or a known trap | [`docs/domain/pitfalls.md`](docs/domain/pitfalls.md) |

[`docs/agent-guide.md`](docs/agent-guide.md) is for an agent **using** Mimi Seed tools at runtime. It is not the
implementation guide for this repository.

## Repository map and ownership

| Path | Owner / purpose |
|---|---|
| `packages/cli/` | `mimi-seed`: onboarding, local/CI orchestration, remote HTTP MCP setup |
| `packages/mcp-server/` | `@yoonion/mimi-seed-mcp`: local stdio MCP, domain tools, auth setup binaries |
| `skills/` | Claude Code and Codex skill sources |
| `.codex-plugin/`, `.mcp.json` | Codex plugin and MCP registration sources |
| `.agents/plugins/marketplace.json` | Codex marketplace manifest |
| `plugins/mimi-seed/` | Generated Codex distribution; never edit directly |
| `docs/domain/` | Contributor ontology: architecture, ownership, SSOTs, and pitfalls |
| `docs/agent-guide.md` | Runtime tool-calling contract for AI agents |
| `docs/{from-source,credentials,troubleshooting}*.md` | Public onboarding docs; English/Korean mirrors |

The private web console is a separate repository with a different transport and auth model. Keep SDK package
implementation here; describe only the public boundary to the web console.

## Codex integration contracts

- `mimi-seed init` scaffolds `AGENTS.md` in a user's project alongside Claude Code context.
- `mimi-seed mcp codex --write` writes the remote HTTP MCP registration to `~/.codex/config.toml`.
- A complete from-source Codex setup installs the repository marketplace/plugin, not only an MCP block, so the
  user receives both the server and `skills/`. See [`docs/from-source.md`](docs/from-source.md).
- Plugin or MCP registration changes must keep Codex and Claude Code guidance aligned where their behavior is
  equivalent, while preserving client-specific instructions where it differs.

## Working rules

1. Check `git status --short` before editing. Preserve unrelated user changes and do not rewrite generated or
   lock files unless the task requires it.
2. Treat code as the final source of truth. Use the SSOT and drift table in the domain index before updating a
   mirrored document.
3. Keep changes in the owning package. The two packages are not a workspace and do not import each other.
4. Keep register files thin: schemas and MCP handlers live in `registers/`; business logic lives in the domain's
   `tools.ts` or focused module.
5. Preserve ESM conventions: TypeScript source imports use `.js` specifiers. Tool names are `snake_case`, files
   are `kebab-case`, and domain directories are lowercase.
6. This is a public repository. Never commit, print, or document secrets, real app/account identifiers, local
   credential contents, or private console internals. Tests and examples must use obvious placeholders.
7. User-facing onboarding applies to Claude Code and Codex when both support the workflow.

Package-specific rules live in [`packages/cli/AGENTS.md`](packages/cli/AGENTS.md) and
[`packages/mcp-server/AGENTS.md`](packages/mcp-server/AGENTS.md). They apply in addition to this file.

## Documentation and generated files

- Do not repeat parameters already defined by a tool schema or flags already defined by `CMD_USAGE`; link to the
  owning source instead.
- Never put release version numbers in domain docs. The root `package.json` and version scripts own them.
- Use “150+” in prose. Exact MCP tool counts belong only in `tool-manifest.json` and
  `docs/domain/tool-catalog.md`.
- Keep English and `.ko` onboarding documents structurally equivalent when changing user-facing guidance.
- Changes to `.codex-plugin/`, `.mcp.json`, `skills/`, `docs/`, or `LICENSE` require `npm run plugin:sync`.
  Commit the resulting `plugins/mimi-seed/` update; do not hand-edit it.

## Verification

Run the narrowest relevant checks first, then the owning package's full checks:

```powershell
# CLI change
npm run build --prefix packages/cli
npm test --prefix packages/cli

# MCP server change
npm run build --prefix packages/mcp-server
npm test --prefix packages/mcp-server

# Plugin, skills, copied docs, manifests, or release metadata
npm run plugin:check

# Cross-package or release-ready verification
npm test
```

The root `npm test` checks Codex plugin drift and runs both package test suites. The root `npm run build` is a
bootstrap operation that installs and builds both packages; prefer package-scoped builds during normal edits.
