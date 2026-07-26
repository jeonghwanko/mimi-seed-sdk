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
- As a *developer*: a newly added tool is invisible-until-selected for Claude Code users, so the `select:`
  batches in `docs/agent-guide.md` §0 are an **inventory contract, not a curated sample** — every registered
  tool must appear in at least one batch, and `docs-drift.test.ts` fails until it does ([[testing]]).

## 2. Draft-app track constraint (Play)

Until an app has its first **non-internal** publish, only the `internal` track may be `completed`;
`alpha`/`beta`/`production` reject anything but `draft` ("Only releases with status draft may be created on
draft app"). Closed/open testing also needs the **App Content** declarations, and those split two ways: **data safety is
scriptable** (`playstore_upload_data_safety` → `applications.dataSafety`, a full-CSV overwrite), while
**content rating and target audience stay Console-only**. Don't treat the latter as bugs in `playstore_*`.

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

The same test also catches a register module that never got wired into `buildServer` (`src/server.ts`): its
tools silently don't exist. Adding the import to `src/index.ts` instead registers nothing — `index.ts` only
picks a run mode ([[architecture]]).

That test guards manifest ↔ **server**, so the *docs* kept drifting behind it (a 2026-07 pass found a tool
missing from the catalog and two stale per-domain counts; a later one found the two READMEs three releases
behind). `src/__tests__/docs-drift.test.ts` now closes the loop: it diffs the manifest against [[tool-catalog]]
— every registered tool must be listed, and the title total + "Counts by domain" table must match — **and**
against the count columns of `README.md` / `README.ko.md`, matching each row to its domain by the tool names
the row lists (so it works in both languages). ❌ Don't hard-code exact totals anywhere else; write "150+" or
point to the manifest/[[tool-catalog]] ([[_index]] "Fact → SSOT → mirror" table, [[testing]]).

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

## 15. Reference video is not renderable media

`video_research_youtube` records public metadata for structure, hook, pacing, and trend research. It deliberately
marks every result `reference-only` and never downloads the video. A reference URL becoming publicly viewable
does not grant reuse rights. `video_build_timeline` therefore accepts only assets whose `assets.json` entry has
recorded provenance and `allowedForRendering=true` (licensed stock, generated output, or user-owned media).
Do not weaken this gate or add an arbitrary-video downloader. Titles, descriptions, author names, and user
observations are also **untrusted external text**: `video_synthesize_research` may summarize them as data but must
never follow instructions embedded in them or claim it watched frames/audio it did not receive.

## 16. TypeScript types do not validate hand-edited project JSON

`project.json`, `assets.json`, `timeline.json`, and `.jobs/*.json` are local files a user or another process can
edit. Values from those files eventually reach FFmpeg arguments and filters, so compile-time interfaces are not
a security boundary. Every read goes through the Zod schemas in `video/schemas.ts`; project, asset manifest, and
timeline also carry the same `projectId` to reject stale cross-project state. Keep JSON writes atomic and validate
again at the file boundary before building a render command.

## Jenkins credential id 충돌 — 같은 이름, 다른 종류

`jenkins_create_credential` / `jenkins_upload_keystore` / `jenkins_upload_playstore_sa` 는 모두 **upsert** 다.
id 가 이미 있으면 갱신한다 — 그런데 종류(Secret text vs Secret file)가 달라도 갱신해 버리면 기존 값이
통째로 사라지고, 그 사실은 다음 빌드가 깨질 때까지 아무도 모른다.

이건 가정이 아니라 실제로 만들 뻔한 지뢰다. `jenkins_upload_playstore_sa` 의 `credential_id` 기본값을
패키지명 파생으로 바꿨을 때 그 이름(`<앱>-app-key`)이 어떤 환경에는 **이미 Secret text 로 앱 키**를 담고
있었다. 기본값으로 한 번 호출하면 앱 키가 Play SA 파일로 덮여 사라졌을 것이다.

두 겹으로 막았다:

- `upsertSecretText` / `upsertSecretFile` 이 기존 credential 의 `_class` 를 먼저 읽고, 종류가 다르면
  **쓰기 전에** 멈춘다. `_class` 는 Jenkins 가 주는 Java 클래스명이라 표시 이름(typeName)과 달리 로케일에
  흔들리지 않는다. 메타데이터를 못 읽으면 막지 않는다 — 부재를 이유로 정상 작업을 차단하지 않는다.
- Play SA 기본 id 는 `<앱>-playstore-sa` 다. 무엇을 담는지가 이름에 드러나야 범용 이름과 부딪히지 않는다.

새 credential 도구를 만든다면 upsert 전에 같은 검사를 붙일 것 (`jenkins-credentials.test.ts`).


## 17. Meta carousel publishing can outlive the default MCP timeout

Threads publishing should use the token-scoped `/me/threads` and `/me/threads_publish` endpoints. A saved numeric
user ID is still useful for account reads, but using it for writes can return Meta `code 24/4279009` even when the
token and account are valid.

Instagram and Threads carousels also create and poll every child container before polling the parent. That can
legitimately exceed the MCP SDK's 60-second default request timeout. Callers that own the MCP client should set a
timeout longer than the server's total media-processing budget. If the client still times out, the publish result
is unknown: inspect the account's latest media before retrying, because the provider may have completed the post
after the client stopped waiting.

The same unknown-result rule applies to `youtube_upload_video`. The upload request streams the local file directly
and can outlive the MCP client's timeout even though YouTube later finishes creating the video. Never automatically
retry a timed-out upload. Check YouTube Studio for a matching recent title/file first; if the call returned a
`videoId`, use `youtube_get_video_status` to reconcile processing and privacy state.
