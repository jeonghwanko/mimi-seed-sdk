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

Releases are automated. Bump the version in the package you changed and push to `main`:

```bash
cd packages/mcp-server
npm version patch --no-git-tag-version   # patch only — see versioning note below
git commit -am "feat(mcp): ..." && git push origin main
```

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
