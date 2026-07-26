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
npx tsc --noEmit                           # packages/cli only: tsup does not type-check

# One file / one case (vitest, run from the package directory)
npx vitest run src/__tests__/docs-drift.test.ts
npx vitest run -t "카탈로그"                # filter by test name
npm run test:watch                         # watch mode

# Doc, manifest, plugin, and version drift only (fast)
npm run plugin:check
```

`npm run plugin:check` = `sync-agent-guide --check` + `sync-codex-plugin --check` + `version --check`. Every one
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
| `cli/…/i18n-coverage.test.ts` | no user-facing Hangul literal outside a `ko` catalog | hardcode a Korean string the compiler can't see | move it into `catalog(ko, en)` |
| `cli/…/credentials.test.ts` | the credential registry's `detect`/`plan` logic, **and** every `mcp-bin` it names exists in the mcp-server `bin` map | reference a bin you didn't publish | add the `bin` + `SUBCOMMANDS` entry |
| `cli/…/setup.test.ts` | the wizard never spawns a stdin-blocking setup bin in a non-interactive environment | make setup prompt or spawn unconditionally | gate on TTY / `--non-interactive` |

The compiler is a guard too: `catalog<T>(ko, en: NoInfer<T>)` makes a **missing English key a build error**, and
ESM/NodeNext makes a missing `.js` import specifier fail the published build ([[pitfalls]] §11).

## Behavior tests (the rest)

Everything else is ordinary unit coverage, named after what it protects — `appstore-*`, `playstore-*`,
`firebase-tools`, `ga4-*`, `googleads`, `gsc-tools`, `admob-tools`, `jenkins-jobs`, `ci-github` / `ci-gitlab`,
`instagram-api` / `threads-api` / `meta-auth`, `video-tools`, `youtube-publish`, `remote-sync`,
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

## What is *not* enforced (still on you)

- The credential file map in [[auth-credentials]] and the command table in [[cli-deploy]] — hand-synced.
- The skill list and count in [[skills-plugins]].
- Prose tool counts elsewhere: write **"150+"**, never a number. Exact counts belong only to
  `tool-manifest.json`, [[tool-catalog]], and the README count columns (the last two are test-enforced).
- Vendor click-paths in `docs/credentials.md` — Apple, Google, and Meta reorganize their consoles on their own
  schedule.
