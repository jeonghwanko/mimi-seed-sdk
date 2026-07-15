# `@yoonion/mimi-seed-mcp` — Codex notes

These instructions extend the repository-level [`AGENTS.md`](../../AGENTS.md) for work under
`packages/mcp-server/`. Read [`docs/domain/architecture.md`](../../docs/domain/architecture.md), then the domain
document matching the change.

## Architecture contract

The normal tool path is:

```text
src/index.ts
  -> src/registers/<domain>.ts       MCP name, description, zod schema, thin handler
  -> src/<domain>/tools.ts           business logic and API calls
  -> provider client                 Google APIs or App Store Connect REST
```

`src/index.ts` also owns subcommand dispatch for setup/admin CLIs. The `bin` map in `package.json` is a
cross-package contract used by `packages/cli/src/mcp-bin.ts`.

## Adding or changing a tool

1. Read [`docs/domain/tool-catalog.md`](../../docs/domain/tool-catalog.md) to find the owning register file and
   check destructive/write semantics.
2. Put API logic in the domain implementation and keep registration/response formatting thin.
3. Add or change the zod input schema in `src/registers/<domain>.ts`.
4. Update `tool-manifest.json` and the corresponding inventory in `docs/domain/tool-catalog.md`. If a domain
   count changes, update the count columns in both root README language variants.
5. Update ready-made runtime selections in `docs/agent-guide.md` only when discoverability or workflow order
   changes. Keep other prose at “150+”; do not copy exact counts elsewhere.
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
