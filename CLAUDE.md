# Mimi Seed SDK — contributor context

Public developer tooling for app launch ops: a CLI (`mimi-seed`, `packages/cli`) + a local stdio MCP server
(`@yoonion/mimi-seed-mcp`, `packages/mcp-server`) exposing 150+ tools across 17 domains (exact inventory:
`packages/mcp-server/tool-manifest.json`, test-enforced) (Play Store, App Store
Connect, Firebase, AdMob, IAM, BigQuery, GA4, Search Console, Google Ads, CI, Jenkins, Facebook, Instagram,
Android signing, AI, Auth, Checks). It drives Google/Apple APIs directly with local `~/.mimi-seed/` credentials;
it does **not** compile binaries.

## Domain ontology (read before non-trivial work)

The structural knowledge base — what exists, how it's wired, why — lives in [`docs/domain/`](docs/domain/). The
index below is imported automatically; the linked docs are not, so `Read` the one matching your task first
(architecture, tool-catalog, auth-credentials, external-apis, cli-deploy, skills-plugins, pitfalls).

@docs/domain/_index.md

## Other docs

- [`docs/agent-guide.md`](docs/agent-guide.md) — operational contract for an **agent calling** the tools
  (deferred-tool loading, call order, safety, `select:` batches). The ontology is the why/how-built layer and
  links to it rather than duplicating it.
- **User-facing onboarding** (EN + `.ko` mirrors, drift-guarded by `docs-onboarding.test.ts`):
  [`docs/from-source.md`](docs/from-source.md) (clone → build → `npm link` → register),
  [`docs/credentials.md`](docs/credentials.md) (how a user *obtains* each of the 12 credentials — the wizard
  deep-links to its anchors, so they are an API), and
  [`docs/troubleshooting.md`](docs/troubleshooting.md) (every `AuthErrorCode` → what the user does).
- [`AGENTS.md`](AGENTS.md) — repo ownership, Codex support, and verification steps.

## Security (public repo)

Describe structure and behavior only. Never commit or echo secrets, real identifiers, or private web-console
internals. See the security notes in [`docs/domain/auth-credentials.md`](docs/domain/auth-credentials.md) and
[`docs/domain/pitfalls.md`](docs/domain/pitfalls.md).

## Verify a change

`npm run build && npm test` inside the package you changed (`packages/cli` or `packages/mcp-server`).
