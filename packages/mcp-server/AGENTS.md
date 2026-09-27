# `@yoonion/mimi-seed-mcp` — Codex notes

These instructions extend the repository-level [`AGENTS.md`](../../AGENTS.md) for work under
`packages/mcp-server/`. Read [`docs/domain/architecture.md`](../../docs/domain/architecture.md), then the domain
document matching the change. The ordered checklists are
[`docs/domain/recipes.md`](../../docs/domain/recipes.md) §1 (tool) and §2 (credential); the guard map is
[`docs/domain/testing.md`](../../docs/domain/testing.md).

## Architecture contract

The normal tool path is:

```text
src/server.ts (buildServer)
  -> src/registers/<domain>.ts       MCP name, description, zod schema, thin handler
  -> src/<domain>/tools.ts           business logic and API calls
  -> provider client                 Google APIs or App Store Connect REST
```

Register modules are wired in `src/server.ts` (`buildServer`) — **not** `src/index.ts`, which is only the
executable entry: it picks a run mode, hands `buildServer()` a transport, and owns the `SUBCOMMANDS` dispatch for
setup/admin CLIs. Wiring a register module into `index.ts` registers nothing. The `bin` map in `package.json` is a
cross-package contract used by `packages/cli/src/mcp-bin.ts`.

Code shared with the CLI — Release Doctor policy and rendering, the `.mimi-seed.json` reader, `resolveLang`, the
atomic credential writer, the AI contract, the CI/Jenkins config shapes — lives in `packages/core/src` and is
imported as `#core/<path>.js`. `npm run build` compiles it into `dist/core/` first (`tsconfig.core.json`) and the
`imports` field of `package.json` resolves `#core/*` there at runtime; typecheck, lint, vitest, and `npm run dev`
read the core source directly. Keep core dependency-free (`node:` builtins only, no `fetch`) —
`core-boundary.test.ts` enforces it ([`architecture.md`](../../docs/domain/architecture.md) "Shared source").

## Adding or changing a tool

1. Read [`docs/domain/tool-catalog.md`](../../docs/domain/tool-catalog.md) to find the owning register file and
   check destructive/write semantics.
2. Put API logic in the domain implementation and keep registration/response formatting thin.
3. Add or change the zod input schema in `src/registers/<domain>.ts`.
4. Update `tool-manifest.json` (name, `total`, write/destructive classification).
5. Run `npm run plugin:sync` at the repository root. It regenerates the inventory in
   `docs/domain/tool-catalog.md`, the tool tables in both root READMEs and this package's `README.md`, and the
   `select:` batches in `docs/agent-guide.md` §0 — a new tool joins its domain's owning batch automatically (a tool
   in no batch is invisible to Claude Code's deferred loading). Notes and batch placement live in
   `scripts/docs-spec.mjs`; never edit inside a `<!-- generated:… -->` block. Keep other prose at “150+”.
6. Add focused tests and run the manifest/drift tests through the full package suite.

## Auth, errors, and safety

- Read [`docs/domain/auth-credentials.md`](../../docs/domain/auth-credentials.md) before touching credential
  discovery or persistence. Keep one writer per credential file.
- Read [`docs/domain/external-apis.md`](../../docs/domain/external-apis.md) before adding provider calls. Preserve
  raw provider reasons while translating them into actionable errors.
- A new `AuthErrorCode` requires a recovery entry in both troubleshooting language variants; tests enforce this.
- Write/destructive tool changes must preserve the preview/check-before-submit flow documented in
  `docs/agent-guide.md`. Do not weaken confirmation expectations in descriptions, prompts, or skills.
- Never emit non-protocol output to stdout while running over stdio. Diagnostics belong on stderr.
- Use absolute file paths for asset operations and do not embed credential or image bytes in logs or docs.

## Verification

```powershell
npm run build
npm test
```

Run these commands from `packages/mcp-server`. For changes that touch plugin-copied docs or skills, return to the
repository root, run `npm run plugin:sync`, and then run `npm run plugin:check`.
