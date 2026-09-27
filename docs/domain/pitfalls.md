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
  tool must appear in at least one batch. The batches are generated (`scripts/gen-docs.mjs`): every domain has an
  owning batch (`fallbackFor` in `scripts/docs-spec.mjs`) that picks up any new tool automatically, and
  `docs-drift.test.ts` still checks the result ([[testing]]).
- A tool can also be *genuinely* absent: `MIMI_SEED_TOOLSETS` / `MIMI_SEED_TOOLSETS_EXCLUDE` in the server's
  `env` drop whole domains at registration ([[architecture]]). `mimi_seed_status` prints the active toolsets —
  read it before calling a missing tool unregistered.
- A **D** tool that "did nothing" usually returned its dry-run preview: without `confirm: true` the registrar
  never runs the handler. That is the contract, not a bug — show the preview, get approval, repeat with confirm.

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
behind; a test that parsed those docs caught the drift but still left the fix to a human). The docs are now
**generated** instead of checked: `scripts/gen-docs.mjs` rewrites the [[tool-catalog]] listing, counts, and
**W** / **D** markers, the three README tool tables, and the agent-guide `select:` batches from the manifest on
`npm run plugin:sync`, and `gen-docs --check` (in `plugin:check` and `docs-drift.test.ts`) fails on any stale
block. ❌ Don't edit inside a `<!-- generated:… -->` block and don't hard-code exact totals anywhere else; write
"150+" or point to the manifest/[[tool-catalog]] ([[_index]] "Fact → SSOT → mirror" table, [[testing]]).

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

같은 종류끼리의 교체도 되돌릴 수 없으므로 세 도구 모두 **새 id 는 바로 만들고, 이미 있는 id 는
`confirm: true` 가 있어야 교체**한다 (없으면 "이미 존재" dry-run — manifest `ownGate`).
`jenkins_upload_playstore_sa` 만 한동안 말없이 덮어썼다가 같은 규칙으로 맞췄다.

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

## 18. A closed stdio transport is not an auth failure

The local MCP process belongs to the client that spawned it. `mimi-seed restart` can terminate that process, but
it cannot attach a replacement process to an already-running client thread. Claude Code can normally reconnect on
the next tool call and exposes `/mcp`; Codex may keep the current thread's transport permanently closed. In Codex,
start a new thread or reload the client, then call `mimi_seed_status` again.

This distinction matters after source builds and plugin updates: the tool names or cached skills may still be
visible even though the live stdio child is gone. A failure reported immediately as `Transport closed`, before a
tool response, is transport state rather than evidence that Google OAuth, YouTube, or store credentials are
invalid. Do not reauthenticate until a new client session can reach the status tool and reports an auth-specific
error.

Do not generalize that rule to a long-running write. If the transport closes during an upload, carousel publish,
or another provider write, the outcome is unknown: the provider may have completed after the client detached.
Inspect the target service for a matching result before retrying. This is the same reconciliation rule as §17.

## 19. TikTok Organic API publishes URLs, not local streams

`/business/video/publish/` does not accept the local MP4 that `video_render` produced. It makes TikTok fetch a
verified HTTPS `video_url`; signed URLs must remain live long enough for that fetch and audit records must strip
their query strings. The URL must return the video directly: TikTok does not follow a 3xx redirect. Mimi Seed
therefore takes both inputs: the local source for ffprobe + SHA-256 validation, and the verified remote URL for
the provider request. Never silently treat the local path as uploaded media.

The publish response may be pending and a POST transport failure is an unknown outcome. The local audit record
blocks the same account + content hash while its state is pending, published, or unknown. Do not add an
`allowDuplicate` escape hatch to an unattended path; reconcile the provider status first. Deduplication must
keep the atomic reservation in addition to the audit lookup, otherwise two workers can both pass a check before
either has written its audit record.

## 20. Tool arguments are attacker-controlled strings — validate at the schema *and* at the boundary

Every tool argument can come from a prompt-injected page, a README, or a review the model just read. A 2026-09
review found three places where a plain `z.string()` flowed into something dangerous:

- **File paths.** `packageName` was joined into `play-service-accounts/<packageName>.json`, so `"../tokens"`
  deleted, overwrote, or remote-synced `~/.mimi-seed/tokens.json`. Package/bundle ids now use the shared schemas
  in `lib/package-name.ts`, **and** `playstore-auth.ts` re-validates and asserts the resolved path stays inside
  its directory — the schema is only the first line, internal callers skip it. `security-package-param.test.ts`
  boots the server and proves every tool with a package-like param rejects `../tokens`; a new tool that uses
  `z.string()` for one fails it.
- **URL paths.** Provider clients built `/appScreenshots/${id}`; an id containing `../` retargeted a `DELETE`
  after URL normalization. Use `encodePathSegment()` (`lib/url-path.ts`) — plain `encodeURIComponent` still lets
  an id of exactly `..` climb one level. `path-encoding.test.ts` rejects an unencoded `/${…}` segment in the
  provider directories.
- **Google resource names.** googleapis puts `name`/`parent`/`resource`/`projectId`/`datasetId`… into the URL
  with *reserved* expansion (`{+name}`), which does **not** encode `/`: `firebase_delete_android_app` with
  `appId: "../../B/androidApps/Z"` removed an app in **another project**. Encoding is no fix (Google does not
  decode `%2F` there), so these ids are *validated* as a single segment with `resourceSegment()` /
  `resourceName()` (`lib/resource-id.ts`). The same `path-encoding.test.ts` scans the Google domain folders, and
  `google-resource-id.test.ts` drives the real googleapis client to prove the request never leaves. BigQuery is
  the exception to the generic segment rule: its "flexible" table names allow Unicode letters/marks/numbers,
  connector punctuation, dashes and spaces, so `bigquery/ids.ts` mirrors BigQuery's own naming rules (which
  already exclude `/ \ ? #`, control characters and `.`). Play (androidpublisher) uses *simple* expansion, which
  does encode `/`; the remaining level-climb — a value of exactly `.` or `..` — is refused for every call by
  `guardDotSegmentParams()` around the `publisher()` client.
- **Executables.** `ffmpegPath` was executed as given; a basename check still let `\\host\share\ffmpeg.exe`
  (UNC/WebDAV — remote binary plus an NTLM hash leak) through. The MCP tools no longer accept it at all (FFmpeg is
  configured by env var / `PATH`); the internal parameter requires a local absolute path, rejects UNC/device
  prefixes before touching the filesystem, then checks realpath + regular file + `ffmpeg` name.

Tools that accept a *file path* to a secret (`serviceAccountJsonPath`, `keystore_path`, `secret_file`) restrict it
to the directory the SDK itself wrote (`lib/path-containment.ts`, realpath-based so a symlink cannot escape) —
otherwise the tool becomes a way to ship any local file to Jenkins or Google.

## 21. Secrets must not round-trip through the transcript

A tool response is stored in the conversation, client logs, and sometimes synced chat history. `iam_create_key`
used to return the whole service-account JSON and `android_generate_keystore` printed the store/key passwords and
the keystore base64 — "delete this chat afterwards" is not a control. Tools that mint a secret now write it
`0600` under `~/.mimi-seed/` (`keys/`, `keystores/`) and return a **path**; the consuming tool takes that path.
Keep the string parameters working for back-compat, but document the path form as the preferred one. The same
rule covers subprocesses: keytool gets passwords via `-storepass:env` / `-keypass:env`, not argv (visible in `ps`).
Dry runs must not echo file content either (`playstore_upload_data_safety` used to print the first CSV line of
any absolute path).

## 22. googleapis has no default timeout

`http-timeout.test.ts` guards raw `fetch`, but most Google calls go through googleapis/gaxios, which has **no**
timeout by default — the same "hung socket blocks a stdio tool forever" defect. `lib/google-timeouts.ts` sets a
60 s default and bounded retries through `google._options` in `googleapis-lite.ts` (googleapis-common merges
`context.google._options` into every request made as `google.<api>(…)`). Media uploads pass
`mediaUploadOptions()` per call — 3 hours by default, overridable with `MIMI_SEED_UPLOAD_TIMEOUT_MS` — so large
files on slow links are not cut off (main had no cap at all; a 30 min cap was a regression). If you ever call a googleapis constructor
another way (not as a method of the `google` lite object), the default is lost — `googleapis-timeout.test.ts`
checks the real request options.

## 23. "Read-only" and "complete" must be enforced, not described

`bigquery_run_query` said "SELECT" in its description and ran DML. It now dry-runs the SQL and refuses any
`statementType` other than `SELECT`. List wrappers that read one page (IAM service accounts, Firebase
projects/services, Play products/subscriptions) silently dropped the rest; `lib/paginate.ts` follows
`nextPageToken` and **fails** rather than truncating at its page cap. A query that outlives its wait window
returns `jobComplete=false` with a note — an empty row set must never look like an empty result.

## 24. Windows refuses to rename over a file someone is reading

`writeFileAtomic` replaces `tokens.json` and friends with `rename(2)`. On Windows that fails with
`EPERM`/`EBUSY`/`EACCES` while another process holds a read handle — antivirus, the search indexer, OneDrive, or
another mimi-seed process reading the token — and the refresh looked like a random auth failure. The rename now
retries only those codes (`RENAME_RETRY_CODES`) on `RENAME_RETRY_DELAYS_MS` (10/20/40/80/160/320/370 ms, exactly
1 s) and still deletes the temp file if it gives up. The CLI used to carry its own copy of the atomic writer, held
in step by a parity test; both packages now import the one implementation in `packages/core` (`#core/atomic-write.js`),
so there is no second schedule to drift.

## 25. `packages/core` works in a checkout and can still break the installed package

`packages/core` is never published — each package compiles it into its own output ([[architecture]] "Shared
source"). In a clone, core sits next to both packages, so almost any mistake still *runs*: an `import` of an npm
package from core resolves through a neighbor's `node_modules`, and a relative `../../core/src/…` import finds the
file. After `npm install @yoonion/mimi-seed-mcp` neither is true — core has no `node_modules`, and a relative path
points outside the package's `dist/`. `core-boundary.test.ts` rejects both, and also a `fetch` in core (network
policy differs per package). The other trap is the module format: tsc decides ESM vs CommonJS from the **source**
file's nearest `package.json`, so `packages/core/package.json` must keep `"type": "module"` — without it, core is
emitted as CommonJS into `dist/core/` and every named import from it fails at startup. Before trusting a change to
core, run the packed-install check in [[recipes]] §8, not just the tests.
