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
| GA4 | GA4 Admin + Data APIs | `googleapis` |
| Search Console | Search Console API | `googleapis` |
| Google Ads | Google Ads reporting | `googleapis` / REST per `googleads_save_config` |
| App Store Connect | ASC REST API | `fetch` + **`jose`** JWT (ES256, minted per request) |
| Facebook / Instagram / Threads | Meta Graph APIs | `fetch`; shared expiry/error recovery in `lib/meta-auth.ts` |
| AI tools | Anthropic Messages API | `@anthropic-ai/sdk` (needs `ANTHROPIC_API_KEY`) |

Key dependency versions (pin points): `googleapis ^171`, `@modelcontextprotocol/sdk ^1.12`, `jose ^5.10`,
`@onesub/providers ^0.2`, `zod ^3.24`. Note the `gaxios` override (`7.1.5`) in `mcp-server/package.json` — it
exists to drop a deprecated transitive `glob`; don't remove it casually.

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

## Security note (public repo)

Error messages may include provider reasons — make sure they never echo **credential values, tokens, `.p8`
contents, or SA JSON**. Translate the *reason*, not the secret. Tests use placeholder fixtures
(`appstore/errors.ts` exposes a `__testing` hook for exactly this) — never paste real API responses that embed
identifiers.
