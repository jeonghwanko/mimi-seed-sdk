# Recipes — step-by-step for the changes people actually make

> Task playbooks for contributors and AI agents (Claude Code · Codex). Each recipe lists **the files to touch,
> in order**, the **guard that fails** if you skip a step, and the **verify** command. The *why* behind each step
> lives in the doc linked from it — this file is the checklist, not the explanation.
>
> Companion: [[testing]] (what each guard actually checks and how to run one). Start-here routing: [[_index]].

## Where does my code go?

| The thing you are adding | Put it in | Never in |
|---|---|---|
| An API call / business logic | `mcp-server/src/<domain>/tools.ts` | a register file |
| A tool's name, description, zod schema, thin handler | `mcp-server/src/registers/<domain>.ts` | `server.ts` / `index.ts` |
| Wiring a **new** register module into the server | `mcp-server/src/server.ts` (`buildServer`) | `mcp-server/src/index.ts` (stdio entry only) |
| A credential's *writer* + validation | the `mcp-server` setup bin that owns it | a second writer in the CLI ([[pitfalls]] §12) |
| A credential's *detection* + "how to fix" text | `cli/src/credentials.ts` (`CredSpec`) | ad-hoc `fs` checks in `doctor` / `setup` |
| A CLI command's behavior | `cli/src/<command>.ts` | `cli/src/index.ts` (router only) |
| User-facing Korean/English text | a `catalog(ko, en)` in the file that prints it | a bare string literal ([[cli-deploy]]) |
| A shared onboarding string | `cli/src/i18n.ts` `t()` | duplicated per command |
| Code **both** packages need (a schema, a rule, a pure helper) | `packages/core/src/`, imported as `#core/<path>.js` (§8) | a copy in each package, or an import across packages |

---

## 1. Add, rename, or delete an MCP tool

1. **Implement** in `mcp-server/src/<domain>/tools.ts`. Resolve credentials through the existing gate
   (`requireAuth` / `requirePlayStoreAuth` / `requireAppStoreCreds`) and wrap provider calls in the matching
   friendly-error translator — [[external-apis]].
2. **Register** in `mcp-server/src/registers/<domain>.ts` with `server.tool(name, description, zodSchema, handler)`
   (`server` is the `ToolRegistrar` — never call `McpServer.tool`/`registerTool` directly).
   Keep the handler thin: validate → call `tools.ts` → format the response.
   *New domain?* also add `registerXxxTools(registrar)` to **`src/server.ts`** — `index.ts` is only the stdio entry
   and the `SUBCOMMANDS` dispatch, so wiring it there registers nothing ([[architecture]]).
3. **Manifest** — `mcp-server/tool-manifest.json`: add/remove the name under its domain and update `total`, then
   **classify** it: `write` (changes state), `destructive` (irreversible / outward-facing / deletes or overwrites —
   the registrar confirm-gates it; list it in `ownGate` only if its own `confirm` flag covers every destructive
   path), `local` (no external service), `idempotent` (a write that is safe to repeat).
   Unlisted = read-only. An unclassified-but-registered name throws at boot. A new domain also needs `label` /
   `credential` / `summary` (the `mimi-seed://tools/catalog` resource serves them, filtered to the active toolsets) and, if it fits
   one, a `toolsets` group.
   *Renaming?* keep the old name for one minor release: leave it in `tools` with the same classification and add
   `"deprecated": { "<old>": "<new>" }` — the registrar registers the alias; remove its own `server.tool` call.
   *Removing an alias (next minor)?* delete the old name from `deprecated`, its domain's `tools`, and every
   classification list, update `total`, and add it to `REMOVED_TOOLS` in `docs-drift.test.ts` for one release so a
   skill, prompt, or doc that brings the old name back fails CI. Keep the (possibly empty) `deprecated` map and the
   registrar's alias support — they are fixture-tested and the next rename reuses them.
4. **Regenerate the docs** — `npm run plugin:sync` from the repo root. `scripts/gen-docs.mjs` rewrites every
   `<!-- generated:… -->` block from the manifest: the [[tool-catalog]] listing (with **W** / **D** and the
   deprecated-alias note), its counts and total, the tool-count tables in `README.md`, `README.ko.md`, and the
   published `packages/mcp-server/README.md`, and the `select:` batches in
   [`../agent-guide.md`](../agent-guide.md) §0 — a new tool is appended to the batch that owns its domain
   (`fallbackFor`), so no tool is ever left out of a batch ([[pitfalls]] §1). The same command then refreshes the
   agent-guide asset and `plugins/mimi-seed/`. Commit everything it touched; never edit inside a generated block.
5. **Presentation (optional)** — `scripts/docs-spec.mjs`, then `npm run plugin:sync` again: a catalog note
   (`catalog.notes`), a better-fitting or new `select:` batch (`batches` — move the tool into that row's `tools`),
   or a README highlight (`domains.<id>.highlights`). *Renamed or deleted?* gen-docs names every spec entry that
   still points at the old tool. *New domain?* gen-docs lists what the spec needs: a `domains` entry (`en` label +
   `highlights`), a catalog `sections` entry (plus its marker pair in [[tool-catalog]]) or a `tables` row, and a
   batch that owns it through `domains` or `fallbackFor`.
6. **Test** it next to the behavior in `mcp-server/src/__tests__/`.
7. **Changelog** — add the tool under `Tool changes` in `[Unreleased]` of the root
   [`CHANGELOG.md`](../../CHANGELOG.md) (added / renamed `old` → `new` / removed). A rename or removal breaks every
   prompt, skill, and `select:` batch that still names the old tool, so it must be spelled out, not implied.

**Guards:** `tool-manifest.test.ts` (server ↔ manifest, classification lists, live annotations) ·
`gen-docs --check` — in `npm run plugin:check` **and** `docs-drift.test.ts` (a stale or missing generated block, a
spec entry naming an unknown or deprecated tool, a domain no batch owns) · `docs-drift.test.ts` (every tool in a
batch, no hard-coded counts in prose, no deprecated alias or recently removed tool in guidance) · `destructive-confirm.test.ts` (every
**D** tool previews without `confirm`) · `prompts-resources.test.ts` (agent-guide copy).
**Verify:** `npm run build && npm test` in `packages/mcp-server`, then root `npm test`.

> Naming: tools are `snake_case`, files `kebab-case`, domain folders lowercase. A tool's **prefix does not
> guarantee its register file** — `checks.ts` owns `playstore_check_submission_risks`, `android.ts` owns
> `jenkins_upload_playstore_sa`. Grep the `server.tool('name'` string ([[pitfalls]] §9).

---

## 2. Add a credential or an auth flow

1. **Pick the single writer.** The package that *validates* the credential owns writing it — in practice an
   mcp-server setup bin. Never add a second writer in the CLI (`ci.json` is the one documented exception);
   that class of bug is [[pitfalls]] §12.
2. **Setup CLI** — `mcp-server/src/<domain>/setup-cli.ts` (or `auth/*-setup-cli.ts`). It must probe the provider
   **before** saving, write with safe permissions, and merge rather than overwrite a shared file.
3. **Two entry points, one contract** — add the bin to `mcp-server/package.json` `bin` **and** to the
   `SUBCOMMANDS` map in `mcp-server/src/index.ts`. The CLI shells out by bin name ([[architecture]]).
4. **Registry** — `cli/src/credentials.ts`: a `CredSpec` with `detect()` (pure fs/env, no network), the `fix`
   command, `obtain` steps, and a `docsAnchor`. `doctor`, `auth status --all`, and `setup` all read this one list.
5. **User docs** — `docs/credentials.md` + `docs/credentials.ko.md`: a section whose anchor **equals** the
   `docsAnchor` (the wizard deep-links to it, so the anchor is an API).
6. **New `AuthErrorCode`?** add a recovery entry to `docs/troubleshooting.md` **and** `.ko`.
7. **File map** — [[auth-credentials]]: add the row (location and role only — never a value).

**Guards:** `docs-onboarding.test.ts` (anchors · EN/KO parity · error codes) · `credentials.test.ts` (every
referenced bin exists in the mcp-server `bin` map) · `package-bin-contract.test.ts` (every published bin maps
to a source entrypoint and `dist` ships) · `setup.test.ts` (never spawns a blocking bin when non-interactive).
**Verify:** both packages — `npm test --prefix packages/mcp-server && npm test --prefix packages/cli`.

> Public repo: the docs may describe *where a credential lives and what reads it*, never a value, a real issuer
> or key id, a service-account email, or a project id. Use `com.example.app`, `<packageName>`,
> `<service-account>@<project>.iam.gserviceaccount.com`.

---

## 3. Add or change a CLI command or flag

1. **Behavior** in `cli/src/<command>.ts`. All user-facing text goes through `catalog(ko, en)` in that file;
   shared onboarding strings live in `cli/src/i18n.ts` `t()`.
2. **Router** — `cli/src/index.ts`: a `case` in `main()`'s `switch`.
3. **Usage** — the `usage.<command>` entry in `cli/src/help.ts`'s `catalog(...)`. That entry *is* the flag SSOT:
   `mimi-seed <cmd> --help` prints it. Add the one-line summary to the `help` block too.
4. **Docs** — the command table in [[cli-deploy]]; the README quick reference only for headline commands.
5. Non-interactive safety: a command must not spawn a stdin-blocking child when `--non-interactive` / not a TTY.

**Guards:** the compiler (`catalog<T>(ko, en: NoInfer<T>)` — a missing English key fails the build) ·
`i18n-coverage.test.ts` (a user-facing Hangul literal outside a `ko` catalog fails) · `deploy-args.test.ts`
for `deploy` flag parsing.
**Verify:** `npm run build && npm test` in `packages/cli` — its `npm test` runs `npm run typecheck` first, because
`tsup` does not type-check.

---

## 4. Change a doc that ships to clients

`docs/`, `skills/`, `.codex-plugin/`, `.mcp.json`, and `LICENSE` are the **Codex distribution sources**. After
editing any of them:

```bash
npm run plugin:sync     # gen-docs blocks, then plugins/mimi-seed/ + packages/mcp-server/assets/agent-guide.md
npm run plugin:check    # what CI runs; also chained into root `npm test`
```

Commit the regenerated `plugins/mimi-seed/`; never hand-edit it. Blocks between `<!-- generated:… -->` markers
(tool catalog, README tool tables, agent-guide §0 batches) are rewritten from `tool-manifest.json` +
`scripts/docs-spec.mjs` on every sync — edit those inputs, not the block. `docs/agent-guide.md` additionally has a
byte-identical copy at `packages/mcp-server/assets/agent-guide.md` (the npm tarball has no `docs/`), which the
server serves as `mimi-seed://agent/guide`.

Editing a user-facing doc with a `.ko` mirror (`credentials`, `troubleshooting`, `from-source`, `user-guide/*`)?
Change **both**, keeping them structurally equivalent. `docs/domain/` is contributor-only and stays English.

---

## 5. Add a skill, prompt, or MCP resource

| Surface | File | Also update |
|---|---|---|
| Skill | `skills/<name>/SKILL.md` (YAML frontmatter: `name`, `description`) | the skill table **and count** in [[skills-plugins]] |
| Slash command | `mcp-server/src/prompts.ts` (`server.prompt`) | [[skills-plugins]], [[architecture]], agent-guide §7 |
| Resource | `mcp-server/src/resources.ts` | same as above |

All three ship to clients → run `npm run plugin:sync` (recipe 4). Skills are a Claude Code / Codex packaging
concept; prompts and resources work in **any** MCP client.

**Guards:** `prompts-resources.test.ts` · `npm run plugin:check`.

---

## 6. Cut a release (maintainers)

The **root `package.json` version is the SDK's single version**; two packages, two plugin manifests, the
generated Codex manifest, and two lockfiles follow it. Never edit those by hand:

```bash
npm run version:set patch     # or minor | major | 0.14.0
npm run version:check         # also enforced by version-sync.test.ts and plugin:check
```

In the same commit, rename `[Unreleased]` in the root [`CHANGELOG.md`](../../CHANGELOG.md) to the new version and
date, and open a fresh empty `[Unreleased]` above it.

Then commit with a [Conventional Commit](https://www.conventionalcommits.org/) message on a release branch,
merge it through a PR (`main` is protected), and push a `v<version>` tag on the merged commit. Only a tag push
publishes: CI checks that the tag matches the root version and is on `main`, then publishes mcp-server and
then cli, skipping any version already on npm. Details and the rationale:
[`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).

Intermediate validation uses `beta.N` or `next.N` versions. `scripts/release-channel.mjs` owns their npm
dist-tags; stable versions alone update `latest`. Batch routine fixes before a stable release.

---

## 7. Before you open the PR

```bash
npm run build && npm test      # inside the package you changed
npm run typecheck              # both packages, tests included — each `npm test` runs this first
npm run plugin:check           # if you touched docs/, skills/, tool-manifest.json, plugin manifests, or versions
npm test                       # root: plugin drift + both suites (the full gate)
```

- `git status --short` first; leave unrelated changes alone and never hand-edit `plugins/mimi-seed/`.
- Keep the change inside the owning package — the two packages do not import each other. A change under
  `packages/core/` belongs to **both**: build and test both (§8).
- Never commit a secret, a real identifier, or private web-console internals ([[pitfalls]] §13).

---

## 8. Share code between the two packages (`packages/core`)

When both packages need the same schema, rule, or pure helper, it goes into `packages/core` once — never a second
copy plus a parity test. The why and the build wiring are in [[architecture]] "Shared source".

1. **Move, don't copy** — `git mv` the file into `packages/core/src/` (subfolders are fine: `checks/…`). It may
   import only `node:` builtins and other core files with `.js` specifiers; no npm package, no `fetch`, no
   package-only helper such as the CLI's `catalog()`. Wording that must differ per package is passed in by the
   caller (see `manifestSocialProfile`'s message set).
2. **Point every importer at it** — `#core/<path>.js` in both packages (tests and `vi.mock(…)` paths too).
   Delete the old copies. Keep a re-export only when many importers use a package-local name (e.g.
   `mcp-server/src/ai/client.ts` → `AI_MODEL`).
3. **Keep the tests where they were** — they now import `#core/…`. Core has no test runner of its own.
4. **Delete the parity guard** that only existed because of the copy, and update its rows in [[testing]] and the
   drift map in [[_index]]; add the module to the table in [[architecture]].

**Guards:** `core-boundary.test.ts` (imports, no `fetch`, `#core/…` only, mcp-server `imports` + build wiring) ·
both packages' typecheck · mcp-server's `tsc -p ../core` and `eslint . ../core`.
**Verify:** **both** packages — `npm run build && npm test` in `packages/mcp-server` **and** `packages/cli`. Then
check `npm pack --dry-run` in mcp-server lists the file under `dist/core/`.
