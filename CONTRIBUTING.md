# Contributing to mimi-seed-sdk

Thanks for your interest! mimi-seed-sdk is the developer-tooling SSOT for Mimi Seed —
the `mimi-seed` CLI and the `@yoonion/mimi-seed-mcp` MCP server.

**New here?** Read the domain ontology in [`docs/domain/`](docs/domain/) first (start at
[`docs/domain/_index.md`](docs/domain/_index.md)) — it maps the architecture, the full tool catalog, the
auth/credential model, and known pitfalls. For *how an agent should call* the tools, see
[`docs/agent-guide.md`](docs/agent-guide.md).

## Repository layout

```
packages/
  cli/          # `mimi-seed` — CLI (tsup build)
  mcp-server/   # `@yoonion/mimi-seed-mcp` — local stdio + remote MCP tools (tsc build)
skills/         # Claude Code / Codex skills
.claude-plugin/ # Claude Code plugin + marketplace manifests
.codex-plugin/  # Codex plugin manifest
docs/
  agent-guide.md # how an agent should call the tools
  domain/        # domain ontology — architecture, tool catalog, pitfalls (start at _index.md)
```

The private web console (`mimi-seed.pryzm.gg`) lives in a separate repo. Keep CLI/MCP
source here — don't move it back into the web repo.

## Development setup

Requires **Node 20+** (`.nvmrc` is the source of truth; CI runs on 22).

```bash
npm run setup     # installs + builds both packages, npm links them, registers the MCP server
```

The full walkthrough — including the Windows and POSIX forms of each command — lives in
**[`docs/from-source.md`](docs/from-source.md)**. Note this is **not** an npm workspace: the root
`package.json` only holds bootstrap scripts, and the two packages install separately.

The PR gate, once you're set up — inside the package you changed:

```bash
npm run build && npm test
```

## Pull requests

1. Branch off `main`.
2. Keep changes scoped to one package where possible.
3. **Build + test must pass** (`npm run build && npm test` in the affected package). The
   mcp-server also type-checks via `tsc`; the CLI builds with `tsup` — run `npx tsc --noEmit`
   there too, since `tsup` does not type-check.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
   `chore:`, `docs:`…). Release notes are auto-generated from commit messages.
5. Adding/changing an MCP tool? Register it in `registers/<domain>.ts` (a **new** register
   module must also be wired into `src/server.ts`), then update
   `packages/mcp-server/tool-manifest.json` — the boot smoke test
   (`src/__tests__/tool-manifest.test.ts`) diffs the live registration list against the
   manifest and fails `npm test` on any mismatch. Refresh the per-domain list in
   [`docs/domain/tool-catalog.md`](docs/domain/tool-catalog.md), and add a test where it
   makes sense (see `src/__tests__/`). Don't hard-code exact tool counts in prose — the
   manifest is the single source of truth (see [`docs/domain/pitfalls.md`](docs/domain/pitfalls.md) §8).

## Releasing (maintainers)

Releases are automated. **The root `package.json` version is the SDK's single version** — both
packages and both plugin manifests follow it. Never edit those four files by hand:

```bash
npm run version:set 0.9.0     # or: patch | minor | major
npm run version:check         # fails if anything drifted (also enforced by a test)
git commit -am "feat(cli): ..." && git push origin main
```

The four followers are `packages/cli`, `packages/mcp-server`, `.claude-plugin/plugin.json`, and
`.codex-plugin/plugin.json`. They used to drift apart (0.7.0 / 0.8.1 / 0.4.1), which left nobody able
to say which CLI matched which server; `version-sync.test.ts` now fails if they do.

One consequence of a single version: bumping it republishes **both** packages, even the one you didn't
touch. That's the trade for never having to reason about cross-package compatibility.

CI then, for each package whose `package.json` version is not yet on npm:
- publishes to npm with **provenance** (signed via GitHub OIDC), and
- creates a **GitHub Release** with auto-generated notes (`<package>-v<version>` tag).

If the version already exists it's skipped (idempotent), so version-less pushes (docs, CI)
are safe. Requires the `NPM_TOKEN` repo secret.

**Versioning:** bump the **patch** number only unless a maintainer decides otherwise.

## License

By contributing, you agree your contributions are licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use requires a separate
license — contact turbo08@gmail.com.
