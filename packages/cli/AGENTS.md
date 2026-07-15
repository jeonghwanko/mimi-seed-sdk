# `mimi-seed` CLI — Codex notes

These instructions extend the repository-level [`AGENTS.md`](../../AGENTS.md) for work under `packages/cli/`.
Read [`docs/domain/cli-deploy.md`](../../docs/domain/cli-deploy.md) before changing command behavior, project
detection, setup, init, or deploy.

## Responsibilities

- `src/index.ts` owns command routing and `CMD_USAGE`, the source of truth for flags and help.
- `src/credentials.ts` owns the credential registry consumed by `setup`, `doctor`, and auth status.
- `src/mcp-bin.ts` launches credential setup binaries owned by the MCP server package.
- `src/mcp-client.ts` talks to the remote HTTP MCP used for onboarding; it is not the local stdio MCP server.
- `src/detect.ts`, `handshake.ts`, and `release-manifest.ts` own the `init` pipeline.
- `src/deploy.ts` orchestrates CI build → readiness check → release notes → store apply.

Keep the CLI as the onboarding and orchestration layer. Store/cloud API implementation belongs in
`packages/mcp-server`.

## Change rules

- Do not add a second writer for credentials owned by an MCP setup binary. The CLI may detect and launch setup;
  validation and persistence remain with the existing owner. `ci.json` is the documented exception.
- Setup and auth commands must not spawn interactive children in non-interactive environments.
- Shared onboarding strings belong in `src/i18n.ts`; command-local strings use `catalog(ko, en)`. Do not leave
  user-facing Hangul literals outside a catalog, and keep the English catalog type-compatible.
- `mimi-seed init` must preserve existing user files. It scaffolds both Claude Code context
  (`.claude/mimi-seed.md`) and Codex context (`AGENTS.md`).
- Keep full PATs and tokens out of logs. Preserve localhost-only callback behavior and safe config permissions.
- If a CLI credential entry references an MCP binary, update the MCP package's `bin`/subcommand contract in the
  same change and run both packages' tests.

## Verification

```powershell
npm run build
npm test
```

Run these commands from `packages/cli`. Relevant focused tests live in `src/__tests__/`; add or update a test
near the behavior being changed before relying on the full suite.
