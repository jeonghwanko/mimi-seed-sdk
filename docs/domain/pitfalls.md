# Pitfalls — learned the hard way

> Validated traps, framed for a developer working **inside** this SDK. The runtime-agent version of several of
> these is in [`../agent-guide.md`](../agent-guide.md) §6 — this doc adds the "why it's built this way" and the
> developer-facing consequences. The inverse (web-console) perspective lives in the **private** web repo's
> domain docs; only the public boundary is restated here.

## 1. Deferred tools (the #1 trap)

Claude Code lazy-loads large tool catalogs: the 150+ tool **names** are visible, but **schemas are not** until
`ToolSearch(query="select:<names>")` loads them. Calling a deferred tool first fails with
`InputValidationError` → people wrongly conclude "this tool doesn't exist" and pivot to `curl`/`fastlane`.

- As a *consumer*: always `select:` before the first call ([[skills-plugins]], agent-guide §0).
- As a *developer*: a newly added tool is invisible-until-selected for Claude Code users — document it in the
  `select:` batches in `docs/agent-guide.md` §0 so agents can find it.

## 2. Draft-app track constraint (Play)

Until an app has its first **non-internal** publish, only the `internal` track may be `completed`;
`alpha`/`beta`/`production` reject anything but `draft` ("Only releases with status draft may be created on
draft app"). Closed/open testing also needs **App Content** declarations (content rating, data safety, target
audience) that are **Console-only** — the API can't set them. Don't treat these as bugs in `playstore_*`.

## 3. A `403` is usually NOT a permissions gap

Every `playstore_*` write resolves the **same** credential (`requirePlayStoreAuth`). If one write succeeds and
another returns `403`, permissions are fine — the cause is app state / policy / an operation-specific
restriction. `friendlyPlayError` surfaces the **raw Google reason**; read it instead of "granting permission".
([[external-apis]].)

## 4. Play edits overwrite un-published Console changes

Committing *any* Play Developer API edit (image, listing, release) discards listing/release changes a user
saved-but-didn't-publish in the Play Console UI. Google warns against editing the same app with both tools at
once. Do all listing writes via the API, **or** finish & publish Console edits first — never interleave.

## 5. CI ≠ Jenkins; there is no `jenkins_trigger_build`

`ci_*` triggers **GitHub Actions / GitLab only**. The `jenkins_*` tools manage **credentials** (keystore,
service account, secrets) and **job definitions** (`jenkins_list_jobs` / `jenkins_get_job_config` /
`jenkins_create_job` / `jenkins_update_job`) — they do **not** start builds. To run a Jenkins job, hit its
REST API. And remember: **Mimi Seed never compiles binaries** — `.aab`/`.ipa` come from EAS/Xcode/Gradle/CI,
not from this SDK.

## 6. Per-package Play SA needs Android Publisher API enabled

The resolved Play service account's **GCP project must have the Android Publisher API enabled**, or *every*
`playstore_*` call returns `403`. Per-package SAs (`play-service-accounts/<packageName>.json`) win over the
default — wrong SA = wrong project = blanket 403. ([[auth-credentials]].)

## 7. Two-repo drift — this SDK is the SSOT

The CLI + local MCP live **only** here. The private web console is a separate repo. Rules:

- ❌ Don't copy `packages/` implementation back into the web repo. The same package in two repos drifts every
  time (it has before).
- ✅ The web repo's landing docs **mirror** this repo's READMEs; the originals are here.
- The two MCP servers both surface as `mimi-seed` — keep them straight by transport + auth ([[architecture]]).

> These are the **contributor-facing** why-it-is-this-way notes. The user-facing version of the recovery steps
> (deferred tools, the Google testing-mode wall, 403-that-isn't-permissions, draft-app state) is
> [`../troubleshooting.md`](../troubleshooting.md) — keep the *why* here and the *fix* there.

## 8. Tool inventory drift — the manifest is the SSOT

Hand-synced tool counts drifted repeatedly (a 2026-07 review found three stale generations of the number at
once). The inventory now lives in `packages/mcp-server/tool-manifest.json`, enforced by a boot smoke test
(`src/__tests__/tool-manifest.test.ts`) that starts the real server and diffs the registered tool list against
the manifest — add/remove/rename a tool without updating the manifest and `npm test` fails.

That test only guards manifest ↔ **server**, so the *docs* kept drifting behind it (a 2026-07 pass found a
tool missing from the catalog and two stale per-domain counts). `src/__tests__/docs-drift.test.ts` now closes
the loop: it diffs the manifest against [[tool-catalog]] — every registered tool must be listed, and the title
total + "Counts by domain" table must match. ❌ Don't hard-code exact totals anywhere else; write "150+" or
point to the manifest/[[tool-catalog]]. The README count columns are still **hand-synced** — check them on
release ([[_index]] "Fact → SSOT → mirror" table).

## 9. Tool name ≠ register file

Find a tool by grepping the `server.tool('name'` **string**, not by its prefix:

- `checks.ts` owns `playstore_check_submission_risks`, `appstore_check_submission_risks`, `release_status`.
- `android.ts` owns `jenkins_upload_playstore_sa`.
- `setup_playstore_connection` is in `playstore.ts` despite the un-prefixed name.

## 10. Stale remote-MCP count strings

Some CLI help text quotes an old remote-MCP tool count. The remote (web-console) tool count is authoritative in
that **other** repo, not here — don't hard-code or "correct" it from this side; prefer wording that doesn't pin
a number. ([[cli-deploy]].)

## 11. ESM `.js` specifiers from `.ts` sources

Both packages are `"type": "module"` with NodeNext resolution: imports must use the **`.js`** extension even in
`.ts` files (`import { x } from './registers/playstore.js'`). Omitting it builds locally with some tooling but
breaks the published `dist`. The MCP server builds with `tsc`, the CLI with `tsup` — verify with
`npm run build && npm test` **inside the changed package** ([[architecture]]).

## 12. One writer per credential file — two writers always drift

`~/.mimi-seed/jenkins.json` had **two** writers with different shapes: the CLI's `deploy setup-jenkins` wrote a
`jenkins` key inside `config.json` (field `user`), while `jenkins_save_config` wrote `jenkins.json` (field
`username`). Neither could see the other, so a user who configured Jenkins via the CLI was told by the MCP tools
that Jenkins was not configured. The same class of bug bites *within* one file too: a whole-file
`writeFileSync` from one writer silently erases fields the other owns.

The rules that came out of it:

- **Exactly one writer per credential.** The package that *validates* the credential owns writing it. The CLI
  shells out to the `mimi-seed-*-auth` bins rather than writing `jenkins.json` / `google-ads.json` /
  `facebook.json` / `instagram.json` / `threads.json` itself ([[cli-deploy]]). `ci.json` is the one CLI-owned file.
- **Merge, don't overwrite**, when a file legitimately holds fields from two sources (`jenkins.json` carries
  connection info *and* the CLI's build-job names).
- **Validate before saving.** A token that can't reach its API must never land on disk — otherwise `doctor`
  reports ✓ for a credential that 403s, and a typo destroys a working config with no backup.
- **Normalize on write, not at each read.** A `host` stored as `ghe.corp.com` verified fine and then made
  `fetch` throw `Invalid URL` at deploy time, because the verifier and the caller built the base URL by
  different rules.

## 13. Secrets hygiene (public repo)

Never log, return, or embed credential values, tokens, `.p8` contents, or SA JSON — not in tool output, error
messages, tests, or these docs. Pass image/asset paths as **absolute paths**; never load image bytes into the
conversation. Use placeholders (`<packageName>`, `com.example.app`) in any example. Full rules in
[[auth-credentials]].

## 14. MCP connected does not mean the Codex plugin is installed

Codex can have the `mimi-seed` MCP server enabled while the `mimi-seed` skills are completely absent. A second
trap is marketplace schema collision: `.claude-plugin/marketplace.json` is valid for Claude Code but its
`source` shape is not the Codex marketplace contract. Pointing Codex at a repo that only has the Claude listing
can register the marketplace name and still report that `mimi-seed` is not found.

- Codex uses `.agents/plugins/marketplace.json` and `plugins/mimi-seed/`.
- Run `npm run plugin:sync` after changing root plugin sources; root `npm test` rejects drift.
- A complete Codex install runs both `codex plugin marketplace add …` and
  `codex plugin add mimi-seed@yoonion`.
- Start a new thread after install; tools and skills are discovered at thread startup.
