# Tests & guards — what fails, and why

> The repo defends its own invariants with tests. This is the map: **which guard owns which fact**, what its
> failure means, and how to run just that one. Read it before you "fix" a red test — most of these failures are
> telling you a *document* or a *manifest* is out of date, not that the code is wrong.
>
> The task checklists that keep these green are [[recipes]]; the drift table they enforce is in [[_index]].

## Running them

```bash
# The full gate (what CI and a PR need to pass)
npm test                                   # root: plugin:check → mcp-server suite → cli suite

# While working — inside the package you changed
npm run build && npm test                  # packages/mcp-server (tsc) or packages/cli (tsup)
npm run typecheck                          # packages/cli only (tsup does not type-check) — its `npm test` runs this first
npm run lint                               # eslint, correctness rules only — both packages' `npm test` run this

# One file / one case (vitest, run from the package directory)
npx vitest run src/__tests__/docs-drift.test.ts
npx vitest run -t "카탈로그"                # filter by test name
npm run test:watch                         # watch mode

# Doc, manifest, plugin, and version drift only (fast)
npm run plugin:check
```

`npm run plugin:check` = `sync-agent-guide --check` + `sync-codex-plugin --check` +
`sync-release-doctor --check` + `version --check`. Every one
of them has a `--check`-less twin (`npm run plugin:sync`, `npm run version:set`) that *fixes* the drift instead
of reporting it. **Test names and failure messages are Korean and usually name the fix** — read the message
before changing any assertion.

## Structural guards (these fail when a doc or manifest drifts)

| Guard | Owns the fact | Fails when you… | Fix |
|---|---|---|---|
| `mcp-server/…/tool-manifest.test.ts` | registered tools ↔ `tool-manifest.json` (boots the real server via `buildServer`) | add / rename / delete a tool, or forget to wire a new register module into `server.ts` | update `tool-manifest.json`; check `server.ts` |
| `mcp-server/…/docs-drift.test.ts` | `tool-manifest.json` ↔ [[tool-catalog]] ↔ the count columns of `README.md`, `README.ko.md`, and the published `packages/mcp-server/README.md` | change tool inventory without updating the catalog section, its "Counts by domain" row, the title total, or a README table | update those docs ([[recipes]] §1) |
| `mcp-server/…/docs-drift.test.ts` (batches) | every registered tool appears in ≥1 `select:` batch in [`../agent-guide.md`](../agent-guide.md) §0, and no batch names a tool that doesn't exist | add a tool without putting it in a batch, or rename one and leave the old name behind | add it to the matching task row (or a new row) |
| `mcp-server/…/docs-onboarding.test.ts` | EN/KO onboarding parity · `docs/credentials.md` anchors (the wizard deep-links them) · every `AuthErrorCode` has a recovery entry · the Node floor matches `.nvmrc` · relative links resolve (user docs **and** `CLAUDE.md` / `AGENTS.md` / `docs/domain/*`) · every `[[wikilink]]` resolves | add an auth error code, a credential, a `.ko` mirror gap, a broken link, or a stale "Node NN+" | write the missing doc section / fix the link |
| `mcp-server/…/prompts-resources.test.ts` | prompts + resources smoke, and `assets/agent-guide.md` is **byte-identical** to `docs/agent-guide.md` | edit the agent guide without syncing | `npm run plugin:sync` |
| `mcp-server/…/version-sync.test.ts` | root `package.json` version == both packages, both plugin manifests, the generated Codex manifest, both lockfiles | hand-edit a version | `npm run version:set <version>` |
| `scripts/sync-codex-plugin.mjs --check` | `plugins/mimi-seed/` == root `.codex-plugin` · `.mcp.json` · `skills` · `docs` · `LICENSE`, plus the Codex marketplace contract | edit a distribution source, or hand-edit the generated copy | `npm run plugin:sync` |
| `scripts/sync-release-doctor.mjs --check` | MCP-owned Release Doctor source == the CLI bundle mirror | edit either copy independently or forget to refresh after a policy change | edit the MCP source, then `npm run release-doctor:sync` |
| `cli/…/i18n-coverage.test.ts` | no user-facing Hangul literal outside a `ko` catalog | hardcode a Korean string the compiler can't see | move it into `catalog(ko, en)` |
| `cli/…/credentials.test.ts` | the credential registry's `detect`/`plan` logic, **and** every `mcp-bin` it names exists in the mcp-server `bin` map | reference a bin you didn't publish | add the `bin` + `SUBCOMMANDS` entry |
| `mcp-server/…/package-bin-contract.test.ts` | every published `package.json` bin target maps from `dist/**/*.js` to an existing `src/**/*.ts` entrypoint, and `dist` is included in the npm package | rename or add a bin without its source file, or stop shipping the compiled directory | add/fix the source entrypoint and keep `files: ["dist", …]` |
| `mcp-server/…/release-doctor.test.ts` + `cli/…/check.test.ts` | the no-login entry path, local mobile-project detection, Target API policy, Billing policy aggregation, the iOS Xcode / SDK minimum (incl. policy-table expiry), and FCM legacy API detection | make `check` require an account again, or report a supported Android build as blocked | preserve the local fallback and update dated policy fixtures with their sources |
| `cli/…/setup.test.ts` | the wizard never spawns a stdin-blocking setup bin in a non-interactive environment | make setup prompt or spawn unconditionally | gate on TTY / `--non-interactive` |
| `cli/…/telemetry.test.ts` | measurement stays opt-in, pseudonymous and best-effort | send credentials, paths, or events without consent | use the explicit payload projection and consent gate |
| `scripts/release-channel.test.mjs` | prereleases cannot update npm latest | publish beta/next without a matching dist-tag | use release-channel.mjs |
| `cli/…/deploy-safety.test.ts` + `jenkins-project.test.ts` | dry-run has no external effects; explicit execution consent; project/job isolation; CI IDs stay separate from store versions | trigger CI during preview, inherit another project's job, or guess an artifact version | preserve the pre-side-effect gate and fail-closed mapping |
| `mcp-server/…/http-timeout.test.ts` | every outbound HTTP call goes through `lib/http.ts` — **no raw `fetch(` anywhere in `src/`** except that file | add a provider client with a bare `fetch` (a hung socket then blocks a stdio tool call forever, uncancellable) | call `fetchWithTimeout` ([[external-apis]]) |
| `cli/…/http-timeout.test.ts` | the same rule for the CLI: every outbound call goes through `cli/src/lib/http.ts` (timeout, readable error, no query string in the message) and Jenkins URLs share one trailing-slash rule | add a CLI caller with a bare `fetch` (a hung CI poll freezes `deploy` with no message) | call `fetchWithTimeout`; pass `HTTP_STREAM_TIMEOUT_MS` for a streamed body |
| `mcp-server/…/security-package-param.test.ts` | every registered tool whose param is named like `packageName` / `package_name(s)` / `bundleId` carries a pattern and rejects `../tokens` at the schema (boots the real server with a tmp HOME) | give a new tool a package id as `z.string()` | use `androidPackageName` / `iosBundleId` from `lib/package-name.ts` ([[pitfalls]] §20) |
| `mcp-server/…/path-encoding.test.ts` | no unencoded `/${…}` path segment in the raw-REST provider clients (`appstore`, `facebook`, `instagram`, `threads`, `googleads`, `ci`, `jenkins`, …) | interpolate a caller id into a REST path | wrap it in `encodePathSegment()` (`lib/url-path.ts`), or add a reasoned allowlist entry |
| `mcp-server/…/googleapis-timeout.test.ts` | googleapis calls carry the default timeout + bounded retry from `lib/google-timeouts.ts` all the way into the request options | rename `google._options` or build an API client outside the lite `google` object | keep constructing clients as `google.<api>(…)` ([[pitfalls]] §22) |
| `mcp-server/…/atomic-write.test.ts` | credential writers use `lib/atomic-write.ts`, never raw `writeFileSync`, and the module list stays complete | write a credential file directly (a torn write leaves truncated JSON that readers swallow as "logged out") | call `writeCredentialJson` / `writeCredentialFile` ([[auth-credentials]]) |
| `cli/…/atomic-write.test.ts` | the same rule for the CLI's own files (`ci.json`, `config.json`, `telemetry.json`, the legacy Jenkins migration), plus: no CLI writer names a credential file the mcp-server owns | write `~/.mimi-seed/*` with `writeFileSync`, or start writing an MCP-owned file from the CLI | `cli/src/lib/atomic-write.ts`; for an MCP-owned file shell out via `mcp-bin.ts` |
| `mcp-server/…/public-repo-hygiene.test.ts` | no private project / Jenkins job / GA4 property / service-account identifier in `packages/*/src`, `docs/`, `skills/` | put a real name in a `describe()` string, a default value, or an example — tool descriptions ship to every MCP client | use the placeholder vocabulary (`com.example.app`, `my-app`, `analytics_123456789`) |
| `mcp-server/…/manifest-schema-parity.test.ts` | the `.mimi-seed.json` contract is identical in both hand-duplicated readers (filename, both unions, interface fields, profile-id pattern, shared exports) | change the schema in one package only | mirror it in the other reader ([[cli-deploy]]) |
| `mcp-server/…/ai-model-parity.test.ts` | one Claude model constant per package, both equal, no literals left anywhere | hard-code a model id, or bump only one package | edit `ai/client.ts` `AI_MODEL` and `cli/src/ai-model.ts` `CLI_AI_MODEL` together |
| `mcp-server/…/jenkins-credentials.test.ts` | credential upsert refuses to overwrite an id that exists with a **different kind** | add a credential tool that upserts by id without checking `_class` — a Secret text holding an app key is silently replaced by a file ([[pitfalls]]) | read the existing kind first, or pick an id that says what it holds |
| `mcp-server/…/ai-parity.test.ts` | the language-independent contract shared by the duplicated AI generators: sentiment keywords, tone/sentiment key sets, `max_tokens` | change a classifier keyword or token budget in one package only — the same review then gets a different tone, or one path truncates | mirror it ([[architecture]] on why the duplication is deliberate) |

The compiler is a guard too: `catalog<T>(ko, en: NoInfer<T>)` makes a **missing English key a build error**, and
ESM/NodeNext makes a missing `.js` import specifier fail the published build ([[pitfalls]] §11). For the CLI the
compiler only counts if you *run* it — `tsup` strips types without checking them, so `packages/cli`'s `npm test`
runs `npm run typecheck` (`tsc --noEmit`) first.

ESLint is the third static gate, wired into both packages' `npm test`. It carries **no formatting rules on
purpose**: reformatting 27k lines would rewrite every file in one commit and destroy `git blame`, and in this
repo the comments carry the "why" and the incident dates, so blame is a real asset. The type-aware rules
(`no-floating-promises`, `await-thenable`, `no-misused-promises`) are the point — this codebase is almost all
async, and a missing `await` looks like success. They lint through `tsconfig.lint.json`, not the build config:
the latter excludes `src/__tests__`, which had left the test files with **no type checking at all**.

### Where each guard actually runs in CI

`.github/workflows/ci.yml` has three jobs, and the split matters:

| Job | Runs | Why separate |
|---|---|---|
| `repo-guards` | root `npm run plugin:check` on the `.nvmrc` version, once (outside the OS matrix) | the package jobs set `working-directory: packages/<pkg>` and therefore **never execute a root script**. No package suite covers `plugins/mimi-seed/` drift, so without this job the `plugin:sync` rule is enforced by nothing. |
| `build-test` (matrix: `cli`/`mcp-server` × node 20/22 on Linux, plus node 22 on Windows) | `npm run build && npm test` — **tests only, never publishes** | node **20** is the declared floor (`.nvmrc`, both `engines`); testing only 22 means nobody ever ran the floor. The Windows leg covers the `.cmd`-shim / `PATH` / path-separator code that a Linux runner never executes. |
| `publish` (main push only) | `needs: [repo-guards, build-test]`; publishes **mcp-server first, then cli**, each skipped if its version is already on npm (`.github/scripts/publish-if-new.sh`) | one sequential job means a failed mcp-server publish stops the cli step — a cli whose pinned MCP bins don't exist on npm is broken on install. Every test leg must be green first. |

`build-test` has `needs: repo-guards` on purpose: a drifted commit is stopped before the tests, not by
mcp-server's `prepublishOnly` in the middle of a release. The publish **trigger** lives only in the `publish`
job's `if:` (plus `on:`); the script itself does not know why it was called.

## Behavior tests (the rest)

`playstore-release.test.ts` checks full rollout replacement even when a target draft already exists,
preservation for draft updates, missing targets, commit failures, and manual-review commit fallback.
`appstore-submit-for-review.test.ts` covers existing review item reuse and item discovery errors.

Everything else is ordinary unit coverage, named after what it protects — `appstore-*`, `playstore-*`,
`firebase-tools`, `ga4-*`, `googleads`, `gsc-tools`, `admob-tools`, `jenkins-jobs`, `ci-github` / `ci-gitlab`,
`instagram-api` / `threads-api` / `meta-auth`, `tiktok-business`, `video-tools`, `youtube-publish`, `remote-sync`,
`auth-*`, `helpers-auth`, `google-errors`, `text-validators` on the server side; `deploy-args`, `ci-providers`,
`mcp-config`, `jenkins-config`, `release-manifest`, `auth`, `ask`, `i18n` on the CLI side.

Conventions worth copying when you add one:

- **No network.** Mock the client (`auth.request`, `fetch`, the provider module) and assert on the *request*
  you build, not on a live response. `src/__tests__/helpers.ts` has `withClient` for booting an in-memory MCP
  server and calling a tool end to end.
- **Fixtures are placeholders.** Never a real token, key, issuer id, SA email, or project id — this is a public
  repo ([[auth-credentials]]).
- **Test the trap, not the happy path.** Most of these files exist because a specific bug shipped once; their
  header comments say which. Keep that comment when you extend the file.

## Coverage — a map, not a gate

```bash
npm run coverage          # both packages; text summary + html in ./coverage
```

Deliberately **no threshold**. A number to hit produces tests written to hit the number, which is the opposite
of this repo's convention ("test the trap, not the happy path"). The report exists to answer one question:
*which module has never been executed at all?* That is how the `iam`, `bigquery`, `android/keystore`,
`ai/*`, `facebook/api`, `appstore/screenshots`, and `checks/screenshots` gaps were found and closed.

## What is *not* enforced (still on you)

- The credential file map in [[auth-credentials]] and the command table in [[cli-deploy]] — hand-synced.
- The skill list and count in [[skills-plugins]].
- ~~Prose tool counts~~ — now enforced: `docs-drift.test.ts` rejects a hard-coded `<n> domains` / `<n> tools` /
  `<n>개 영역` in `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, the agent guide, `docs/domain/*`, and every
  `SKILL.md`. Write **"150+"** or name the domains; exact counts belong only to `tool-manifest.json`,
  [[tool-catalog]], and the README count columns.
- Vendor click-paths in `docs/credentials.md` — Apple, Google, and Meta reorganize their consoles on their own
  schedule.
