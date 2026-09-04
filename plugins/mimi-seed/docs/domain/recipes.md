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
| A CLI command's behavior | `cli/src/<command>.ts` | `cli/src/index.ts` (router + usage only) |
| User-facing Korean/English text | a `catalog(ko, en)` in the file that prints it | a bare string literal ([[cli-deploy]]) |
| A shared onboarding string | `cli/src/i18n.ts` `t()` | duplicated per command |

---

## 1. Add, rename, or delete an MCP tool

1. **Implement** in `mcp-server/src/<domain>/tools.ts`. Resolve credentials through the existing gate
   (`requireAuth` / `requirePlayStoreAuth` / `requireAppStoreCreds`) and wrap provider calls in the matching
   friendly-error translator — [[external-apis]].
2. **Register** in `mcp-server/src/registers/<domain>.ts` with `server.tool(name, description, zodSchema, handler)`.
   Keep the handler thin: validate → call `tools.ts` → format the response.
   *New domain?* also add `registerXxxTools(server)` to **`src/server.ts`** — `index.ts` is only the stdio entry
   and the `SUBCOMMANDS` dispatch, so wiring it there registers nothing ([[architecture]]).
3. **Manifest** — `mcp-server/tool-manifest.json`: add/remove the name under its domain and update `total`.
   A new domain also needs `label` / `credential` / `summary`; the `mimi-seed://tools/catalog` resource serves
   that file verbatim.
4. **Catalog doc** — [[tool-catalog]]: add the backticked tool name to its domain section, mark **W** (write) or
   **D** (destructive), and update the "Counts by domain" row **and** the title total.
5. **README count columns** — the tool-list table in `README.md`, `README.ko.md`, **and** the published
   `packages/mcp-server/README.md`. All three are test-enforced (each row is matched to its domain by the tool
   names it lists, so keep one domain per row).
6. **Agent guide** — [`../agent-guide.md`](../agent-guide.md) §0: add the tool to the `select:` batch of the
   task it belongs to. This is **required, not optional** — in Claude Code a tool that is in no batch is
   invisible until someone happens to keyword-search for it ([[pitfalls]] §1), so `docs-drift.test.ts` fails
   until every registered tool appears in at least one batch. Add a new row when no existing task fits.
7. **Test** it next to the behavior in `mcp-server/src/__tests__/`.
8. If step 6 touched `docs/`: `npm run plugin:sync` from the repo root, and commit `plugins/mimi-seed/`.

**Guards:** `tool-manifest.test.ts` (server ↔ manifest) · `docs-drift.test.ts` (manifest ↔ catalog ↔ READMEs) ·
`prompts-resources.test.ts` (agent-guide copy) · `npm run plugin:check`.
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
3. **Usage** — the `usage.<command>` entry in the same file's `catalog(...)`. That entry *is* the flag SSOT:
   `mimi-seed <cmd> --help` prints it. Add the one-line summary to the `help` block too.
4. **Docs** — the command table in [[cli-deploy]]; the README quick reference only for headline commands.
5. Non-interactive safety: a command must not spawn a stdin-blocking child when `--non-interactive` / not a TTY.

**Guards:** the compiler (`catalog<T>(ko, en: NoInfer<T>)` — a missing English key fails the build) ·
`i18n-coverage.test.ts` (a user-facing Hangul literal outside a `ko` catalog fails) · `deploy-args.test.ts`
for `deploy` flag parsing.
**Verify:** `npm run build && npm test` in `packages/cli`, plus `npx tsc --noEmit` — `tsup` does not type-check.

---

## 4. Change a doc that ships to clients

`docs/`, `skills/`, `.codex-plugin/`, `.mcp.json`, and `LICENSE` are the **Codex distribution sources**. After
editing any of them:

```bash
npm run plugin:sync     # regenerates plugins/mimi-seed/ + packages/mcp-server/assets/agent-guide.md
npm run plugin:check    # what CI runs; also chained into root `npm test`
```

Commit the regenerated `plugins/mimi-seed/`; never hand-edit it. `docs/agent-guide.md` additionally has a
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

Then commit with a [Conventional Commit](https://www.conventionalcommits.org/) message — release notes are
generated from it. CI publishes each package whose version is not yet on npm (idempotent, so version-less
pushes are safe). Details and the rationale: [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).

---

## 7. Before you open the PR

```bash
npm run build && npm test      # inside the package you changed
npx tsc --noEmit               # packages/cli only — tsup does not type-check
npm run plugin:check           # if you touched docs/, skills/, manifests, or versions
npm test                       # root: plugin drift + both suites (the full gate)
```

- `git status --short` first; leave unrelated changes alone and never hand-edit `plugins/mimi-seed/`.
- Keep the change inside the owning package — the two packages do not import each other.
- Never commit a secret, a real identifier, or private web-console internals ([[pitfalls]] §13).
