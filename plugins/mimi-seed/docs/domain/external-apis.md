# External APIs & error translation

> What each domain actually talks to, and how raw provider errors become human-friendly messages. For the auth
> material behind these calls see [[auth-credentials]]; for the register→tools→client layering see
> [[architecture]].
>
> SSOT: `packages/mcp-server/package.json` (deps), `<domain>/tools.ts`, `src/lib/google-errors.ts`,
> `src/playstore/errors.ts`, `src/appstore/errors.ts`, `src/helpers.ts`.

## API clients by domain

| Domain | Talks to | Client |
|---|---|---|
| Firebase | Firebase Management API | `googleapis` |
| AdMob | AdMob API | `googleapis` |
| Google Play | Android Publisher API (releases, listings, images, products) | `googleapis` + `@onesub/providers` for IAP/subscriptions |
| IAM | Cloud IAM (service accounts, keys, policy bindings) | `googleapis` |
| BigQuery | BigQuery API | `googleapis` |
| GA4 | GA4 Admin v1beta (속성/스트림), Admin v1alpha (BigQueryLink) + Data v1beta APIs | `googleapis` |
| Search Console | Search Console API | `googleapis` |
| Google Ads | Google Ads reporting | `googleapis` / REST per `googleads_save_config` |
| YouTube publishing | YouTube Data API v3 (upload, processing/status, privacy) | `googleapis` + local file streams |
| App Store Connect | ASC REST API | `fetch` + **`jose`** JWT (ES256, minted per request) |
| Facebook / Instagram / Threads | Meta Graph APIs | `fetch`; shared expiry/error recovery in `lib/meta-auth.ts` |
| AI tools | Anthropic Messages API | `@anthropic-ai/sdk` (needs `ANTHROPIC_API_KEY`) |
| Video production | Anthropic storyboard + YouTube Data API + Pexels API + OpenAI Image API + local FFmpeg/ffprobe | `@anthropic-ai/sdk` + `fetch` + `child_process` |

Dependency ranges live in `mcp-server/package.json` (the SSOT — read it rather than trusting a number here):
today `googleapis ^171`, `@modelcontextprotocol/sdk ^1.12`, `jose ^5.10`, `@onesub/providers ^0.4`,
`zod ^3.24`, `@anthropic-ai/sdk ^0.52`. Note the `gaxios` **override** (`7.1.5`) in the same file — it exists to
drop a deprecated transitive `glob`; don't remove it casually.

## Auth gate before a call — `src/helpers.ts`

Tools resolve credentials through shared gates, not ad hoc file reads:

- `requireAuth(requiredScope?)` — ensures a fresh Google OAuth token (delegates to
  `auth/google-auth.ts:ensureFreshAccessToken`).
- `requirePlayStoreAuth(packageName?)` / `requireServiceAccountJson(packageName?)` — resolve the **per-package**
  Play service account (falls back to the default). See [[auth-credentials]].
- `requireAppStoreCreds()` — loads ASC key material for the JWT minter.
- `PLAY_AUTH_HINT` / `APPSTORE_AUTH_HINT` — the exact "run this to fix it" text returned when auth is missing.

✅ New tools should call the matching `require*` gate first. ❌ Don't re-read `~/.mimi-seed/*.json` directly.

## Friendly-error translation (the layer that makes 403s readable)

Raw `googleapis` / ASC errors are opaque. Three translators turn them into actionable `Error`s — always wrap
outbound calls in them so the user sees *why*, not a stack trace:

| Function (file) | Use for |
|---|---|
| `friendlyGoogleError(e)` — `lib/google-errors.ts` | any `googleapis` call (Firebase, AdMob, IAM, BigQuery, GA4, GSC, Ads) |
| `friendlyPlayError(e, packageName?)` — `playstore/errors.ts` | Play Developer API calls — adds Play-specific reasons (app state, policy, draft-app track) on top of the Google one |
| `friendlyAppStoreError(status, body)` — `appstore/errors.ts` | ASC REST responses |
| `metaApiError(platform, status, message, code?)` — `lib/meta-auth.ts` | Meta token expiry/revocation and safe recovery commands |

Supporting helpers in `lib/google-errors.ts`: `extractHttpStatus(e)`, `rawMessage(e)`, `googleErrorDetail(e)`
(pulls the nested Google reason), `authReauthMessage(text)` (detects expired-token text → re-auth hint), and
`withCause(err, cause)`.

### Why `friendlyPlayError` carries the raw reason — the `403` trap

Every `playstore_*` write resolves the **same** credential (`requirePlayStoreAuth`). So if
`playstore_upload_image` succeeds but `playstore_update_listing` returns `403`, the account permissions are
fine — the cause is app state / policy / an operation-specific restriction. `friendlyPlayError` surfaces that
**raw Google reason** instead of implying a missing grant. Do not "fix" it by changing permissions. Full
write-up in [[pitfalls]] and [`../agent-guide.md`](../agent-guide.md) §6.

## Every outbound call goes through `lib/http.ts`

Node's `fetch` has **no default response timeout**. Over stdio that is not a slow call, it is a dead session:
the tool never returns and the MCP client has no way to cancel it. So there is exactly one entry point —
`fetchWithTimeout(input, init?, timeoutMs?)` — and `http-timeout.test.ts` rejects a raw `fetch(` anywhere in
`src/` outside that file.

- `HTTP_TIMEOUT_MS` (60s) — the default; JSON/metadata calls.
- `HTTP_TRANSFER_TIMEOUT_MS` (10m) — byte transfers. The signal stays armed while the body streams, so a 60s
  cap would sever a large screenshot/preview upload or stock-asset download mid-flight. Pass it explicitly.

A caller-supplied `init.signal` wins (the wrapper never overrides someone else's cancellation, and disables
retry). Timeouts are re-thrown as an actionable message carrying `host + pathname` only — **never the query
string**, because Meta Graph calls put `access_token=` there and an error string ends up in agent transcripts.

### Retry policy — the idempotency split is the whole point

Play, ASC, and Meta all return 429 and transient 5xx during normal operation. Retrying blindly is worse than
not retrying, so the rule splits on what a repeat request can do:

| Failure | GET/HEAD/PUT/DELETE | POST |
|---|---|---|
| **429** | retry | **retry** — the rate limiter rejects *before* handling, so no duplicate is created |
| 5xx · 408 · 425 | retry | **no** — the server may have already applied it; a repeat creates a second version / product / review submission |
| fast network error (ECONNRESET, DNS) | retry | **no** — you cannot know whether the request arrived |
| **timeout** | **no** | **no** — see the budget below |
| any other 4xx | no | no |

`Retry-After` (seconds or HTTP-date) wins over the exponential backoff, clamped to 20s at the top and **250ms
at the bottom**. The floor matters: `Retry-After: 0` is legal, and obeying it literally means firing the next
request with no delay at a server that just said it is rate-limiting you — and a zero wait advances no wall
clock, so the total budget below stops holding. Bodies that cannot be replayed (streams) disable
retry, because re-sending a consumed stream silently posts an empty request. Chunked uploads are `PUT`, so they
get the retry that matters most: a transient blip mid-upload no longer strands a half-uploaded asset.

**Total time budget = `timeoutMs + 30s`, and a timeout is never retried.** This is not a detail — v0.15.0
shipped without it and turned the transfer ceiling from 10 minutes into 30 (600s × 3 attempts), which is exactly
the hang this module exists to prevent. Retrying is cheap when the failure comes back fast (429/5xx) and
ruinous when the failure *is* "we already waited the whole budget". The last attempt's timeout is shrunk to
whatever budget remains, so the ceiling holds even against a server that answers slowly every time.

When testing a failure path, use `withoutBackoff()` from `__tests__/helpers.ts` and give the mock a **factory**
(`mockImplementation(() => res)`, not `mockResolvedValue(res)`) — retries receive a fresh response each attempt,
and a shared `Response` has its body consumed by the first attempt.

`googleapis`-based domains don't use this — they go through the Google client, which carries its own timeouts.

## Security note (public repo)

Error messages may include provider reasons — make sure they never echo **credential values, tokens, `.p8`
contents, or SA JSON**. Translate the *reason*, not the secret. Tests use placeholder fixtures
(`appstore/errors.ts` exposes a `__testing` hook for exactly this) — never paste real API responses that embed
identifiers.
