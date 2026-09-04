# Mimi Seed SDK — contributor context

Public developer tooling for app launch ops: a CLI (`mimi-seed`, `packages/cli`) + a local stdio MCP server
(`@yoonion/mimi-seed-mcp`, `packages/mcp-server`) exposing 150+ tools across the domains below (exact inventory:
`packages/mcp-server/tool-manifest.json`, test-enforced) — Play Store, App Store Connect, Firebase, AdMob, IAM,
BigQuery, GA4, Search Console, Google Ads, CI, Jenkins, Facebook, Instagram, Threads, Android signing, video
production (incl. YouTube publishing), AI, Auth, Checks. It drives Google/Apple APIs directly with local
`~/.mimi-seed/` credentials; it does **not** compile binaries.

This file and [`AGENTS.md`](AGENTS.md) (Codex) carry the **same contract** — keep them aligned when either changes.

## Domain ontology (read before non-trivial work)

The structural knowledge base — what exists, how it's wired, why — lives in [`docs/domain/`](docs/domain/). The
index below is imported automatically; the linked docs are **not**, so `Read` the one matching your task first.

@docs/domain/_index.md

| Task | Read first |
|---|---|
| "How do I do this?" — ordered checklist per task + the guard that catches a miss | [`docs/domain/recipes.md`](docs/domain/recipes.md) |
| A test went red, or "what will catch me?" | [`docs/domain/testing.md`](docs/domain/testing.md) |
| Package layout, MCP bootstrap, register pattern | [`docs/domain/architecture.md`](docs/domain/architecture.md) |
| Add / rename / find an MCP tool | [`docs/domain/tool-catalog.md`](docs/domain/tool-catalog.md) |
| Credentials, OAuth, service accounts, JWT | [`docs/domain/auth-credentials.md`](docs/domain/auth-credentials.md) |
| Google / Apple API calls and error translation | [`docs/domain/external-apis.md`](docs/domain/external-apis.md) |
| CLI commands, init, setup, deploy | [`docs/domain/cli-deploy.md`](docs/domain/cli-deploy.md) |
| Skills, plugin manifests, slash commands | [`docs/domain/skills-plugins.md`](docs/domain/skills-plugins.md) |
| Unexpected behavior, or "why is it built this way?" | [`docs/domain/pitfalls.md`](docs/domain/pitfalls.md) |

## Working rules

1. **Code is the SSOT**; these docs mirror it. On a conflict, believe the code and fix the doc — the drift map in
   the ontology index says which facts are test-enforced and which are hand-synced.
2. **Stay in the owning package.** The two packages are not a workspace and never import each other. The CLI's
   `src/checks` Release Doctor files are generated mirrors: edit the MCP source, then run
   `npm run release-doctor:sync`; never hand-edit the mirror.
3. **Register files stay thin** — name, description, zod schema, thin handler in `registers/<domain>.ts`; API
   logic in `<domain>/tools.ts`. A *new* register module is wired into `src/server.ts`, not `src/index.ts`.
4. **One writer per credential file.** The package that validates a credential owns writing it (`ci.json` is the
   documented exception). Two writers always drift.
5. **ESM conventions**: `.ts` sources import with `.js` specifiers; tools are `snake_case`, files `kebab-case`,
   domain folders lowercase.
6. **User-facing CLI text goes through `catalog(ko, en)`** — a bare Korean literal fails `i18n-coverage.test.ts`.
7. **Don't hard-code tool or domain counts in prose** — write "150+" and name the domains instead of counting
   them. Exact counts live only in `tool-manifest.json`, `docs/domain/tool-catalog.md`, and the README count
   columns (all test-enforced); a guard rejects them anywhere else.
8. **Editing `docs/`, `skills/`, `.codex-plugin/`, `.mcp.json`, or `LICENSE`** → `npm run plugin:sync`, then
   commit the regenerated `plugins/mimi-seed/`. Never hand-edit that folder.
9. **Version numbers** belong to the root `package.json` (`npm run version:set`) — never write one into a doc.
10. Keep Claude Code and Codex guidance equivalent where the behavior is (`CLAUDE.md` ↔ `AGENTS.md`,
    `.claude-plugin/` ↔ `.codex-plugin/`).

## Other docs

- [`docs/agent-guide.md`](docs/agent-guide.md) — operational contract for an **agent calling** the tools
  (deferred-tool loading, call order, safety, `select:` batches). The ontology is the why/how-built layer and
  links to it rather than duplicating it. It has a byte-identical copy in `packages/mcp-server/assets/`.
- **User-facing onboarding** (EN + `.ko` mirrors, drift-guarded by `docs-onboarding.test.ts`):
  [`docs/from-source.md`](docs/from-source.md) (clone → build → `npm link` → register),
  [`docs/credentials.md`](docs/credentials.md) (how a user *obtains* each credential — the wizard deep-links to
  its anchors, so they are an API), [`docs/troubleshooting.md`](docs/troubleshooting.md) (every `AuthErrorCode` →
  what the user does), and [`docs/user-guide/`](docs/user-guide/README.md) (the end-to-end journey).
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — PR gate, commit convention, release automation.

## Security (public repo)

Describe structure and behavior only. Never commit or echo secrets, real identifiers, or private web-console
internals; examples use placeholders (`com.example.app`, `<packageName>`). See the security notes in
[`docs/domain/auth-credentials.md`](docs/domain/auth-credentials.md) and
[`docs/domain/pitfalls.md`](docs/domain/pitfalls.md).

## Verify a change

```bash
npm run build && npm test      # inside the package you changed
npm run typecheck              # packages/cli only — tsup does not type-check (its `npm test` runs this first)
npm run plugin:check           # docs / skills / manifests / versions
npm test                       # root: plugin drift + both package suites
```

What each red test is telling you: [`docs/domain/testing.md`](docs/domain/testing.md).
