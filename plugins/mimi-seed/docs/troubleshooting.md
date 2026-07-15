# Troubleshooting

Every error below already prints an actionable hint. This page adds what a one-line hint can't say: **which
console, whose permission, and how long to wait.**

Start here: `mimi-seed doctor` — it reports all twelve credentials and the exact command to fix each one.

---

<a id="install"></a>

## 1. Install & registration

**The mimi-seed tools don't appear at all.**
Start a **new session**. `claude mcp add`, a plugin install, and an update all take effect only in a fresh
session — the tool list is read at startup.

**The first tool call fails with `InputValidationError`.**
Not a broken tool. Claude Code lazy-loads large tool catalogs: the names are visible but the *schemas* are not
loaded yet. Tell Claude: *"load the mimi-seed tools with ToolSearch first."* See
[`agent-guide.md`](agent-guide.md) §0.

**I updated, but I'm still getting the old behavior.**
`npx` caches. New skills with an old server is the classic split. Follow the `mimi-seed-update` skill rather
than reinstalling in a loop.

**Node version errors.**
Node 20+ is required, for both the CLI and the MCP server. `.nvmrc` is the source of truth — `nvm use`.

**Running from a git checkout and the binary behaves like an old version.**
`npm link` links `dist/`, not `src/`. Re-run `npm run build` after every source change. See
[`from-source.md`](from-source.md).

---

<a id="google-signin"></a>

## 2. Google sign-in

These are the `AuthErrorCode` values the auth layer reports. The code is printed in the error — match on it.

<a id="user-denied"></a>

### `USER_DENIED` — "access blocked", and you never clicked deny

**The single most common first-run wall.** The OAuth app is Google-unverified (**testing** mode), so only
registered test users can sign in. Google phrases this as a denial.

**What you do:** ask whoever operates the app to add your Google account under *Google Cloud Console → OAuth
consent screen → Test users*. Then retry. **Retrying without that will never succeed.** If you *did* click deny,
just run it again and approve every scope.

<a id="config-fetch-failed"></a>

### `CONFIG_FETCH_FAILED` — couldn't fetch the OAuth client config

Login needs an OAuth client id/secret, and it fetches them **at runtime from the Mimi Seed web console**. This
is a real network dependency, and it is the one that surprises people running from source, offline, or behind a
corporate proxy or captive portal (a captive portal returns `200` with HTML, which fails just the same).

**What you do:** confirm you can reach the web console. If you can't — or you're self-hosting — bring your own
Google OAuth client:

```bash
export MIMI_SEED_GOOGLE_CLIENT_ID=...
export MIMI_SEED_GOOGLE_CLIENT_SECRET=...
```

Create it as a **Desktop app** client with a loopback redirect on port **9876**.

<a id="rapt-required"></a>

### `RAPT_REQUIRED` — Workspace reauth policy (`invalid_rapt`)

Your Google Workspace admin enforces periodic reauthentication, and it is refusing to refresh the token. Logging
in again buys you hours, not a fix.

**The durable fix is a service account**, which is exempt from the policy — for BigQuery, that's
`mimi-seed auth bigquery` ([credentials](credentials.md#bigquery)).

<a id="invalid-grant"></a>

### `INVALID_GRANT` — the refresh token is dead

Revoked or expired. Note that Google expires refresh tokens issued by an app in **testing** publishing status
**7 days after issuance** — not 7 days after last use. Logging in daily does not keep it alive; you will hit
this weekly until the app is verified.

**What you do:** `mimi-seed auth login` again.

<a id="insufficient-scope"></a>

### `INSUFFICIENT_SCOPE` — token is valid, but lacks a scope

A newer scope shipped (this is how `adwords` for Google Ads arrived) and your token predates it. This is **not**
a permissions grant you need to chase in a console.

**What you do:** `mimi-seed auth login --force`.

<a id="invalid-client"></a>

### `INVALID_CLIENT` — client id/secret doesn't match the token

Almost always this: you set `MIMI_SEED_GOOGLE_CLIENT_ID` / `_SECRET` once, minted a token against it, then ran
again *without* those variables (or with different ones). The token and the client must come from the same
place.

**What you do:** set the same variables again, or delete `~/.mimi-seed/tokens.json` and log in cleanly.

<a id="unauthorized-client"></a>

### `UNAUTHORIZED_CLIENT` — grant type or scope not allowed for this client

The consent you hold doesn't cover what's being asked. Log in again to get fresh consent:
`mimi-seed auth login --force`.

<a id="no-refresh-token"></a>

### `NO_REFRESH_TOKEN` — token file exists, refresh token missing

The stored grant is unusable for silent refresh. Log in again — the flow always requests offline access.

<a id="unauthenticated"></a>

### `UNAUTHENTICATED` — no token at all

`~/.mimi-seed/tokens.json` doesn't exist. Run `mimi-seed setup` (or `mimi-seed auth login`).

<a id="callback-port-in-use"></a>

### `CALLBACK_PORT_IN_USE` — port 9876 is taken

The login flow listens on **9876** for Google's redirect. Something else has it — often an abandoned earlier
login attempt.

**What you do:** kill that process, or wait a moment and retry.

<a id="callback-timeout"></a>

### `CALLBACK_TIMEOUT` — no callback arrived in time

You didn't finish the browser approval, or the browser never opened (headless box, SSH session, WSL).

**What you do:** `mimi-seed auth login --no-browser` — it prints the URL so you can open it somewhere with a
browser. The callback still has to reach *this* machine's port 9876, so forward the port if you're on a remote
host.

<a id="browser-open-failed"></a>

### `BROWSER_OPEN_FAILED` — couldn't launch a browser

Defined, but you are unlikely to see it: when the browser can't be opened, the login flow just prints the URL
inline and keeps waiting. Open it yourself, or re-run with `--no-browser`.

<a id="refresh-network-error"></a>

### `REFRESH_NETWORK_ERROR` — can't reach Google's token endpoint

`oauth2.googleapis.com` is unreachable. Check connectivity, proxy, and firewall. Corporate TLS interception is a
frequent cause.

<a id="code-exchange-failed"></a>

### `CODE_EXCHANGE_FAILED` — the code → token exchange failed

The browser approval succeeded but the exchange didn't. Usually transient. Retry; if it persists, check for a
proxy rewriting the request, and try `--no-browser`.

<a id="token-response-invalid"></a>

### `TOKEN_RESPONSE_INVALID` — response was missing tokens

Google returned a response with no access/refresh token. Retry with `--force`; if it survives that, an
intermediary is mangling the response.

<a id="refresh-unknown"></a>

### `REFRESH_UNKNOWN` — unclassified refresh failure

The catch-all. Retry once; if it repeats, log in again with `mimi-seed auth login --force` and include the error
`code` (never the token) if you file an issue.

---

<a id="403-but-permissions-look-fine"></a>

## 3. "It says 403, but my permissions are fine"

The most expensive misdiagnosis in this tool, because the fix is nowhere near where you're looking.

**Play — every single call 403s.** The service account's GCP project probably doesn't have the **Android
Publisher API enabled**. This is an *API enablement* problem, not a *permissions* problem, and no amount of
re-granting roles in Play Console will fix it.

**Play — a specific app 403s while others work.** You're hitting the wrong service account. Per-package service
accounts override the default one; if a package maps to an SA from a different GCP project, that project has its
own API enablement and its own grants. Ask for `playstore_list_service_accounts` to see the mapping.

**Play — you just granted access and it still 403s.** Wait ~5 minutes. Play Console permission grants take time
to propagate. This one resolves itself.

**Google Ads — 403 / permission denied.** Usually the `adwords` OAuth scope, not an Ads permission →
[`INSUFFICIENT_SCOPE`](#insufficient-scope). Also possible: your developer token hasn't been approved out of test
tier yet ([credentials](credentials.md#google-ads)).

**GitHub — reading works, triggering a workflow 403s.** Your PAT lacks the **`workflow`** scope.
Reissue it with both `repo` and `workflow` ([credentials](credentials.md#ci-github-gitlab)).

---

<a id="store-state"></a>

## 4. Store behavior that looks like a bug but isn't

- **A brand-new app rejects everything.** Until the first build is uploaded **by hand** in Play Console, an app
  is a draft and most track/release operations don't apply to it. The API cannot bootstrap an app from nothing.
- **App Content declarations aren't in the API.** Data safety, ads, target audience — Play Console only. No tool
  will do these for you.
- **Your unpublished Console edits disappeared.** A Play API edit commits the whole draft. If you were
  mid-edit in the Console on the same app, your uncommitted changes get overwritten. Finish one before starting
  the other.

The *why* behind each of these lives in [`domain/pitfalls.md`](domain/pitfalls.md).

---

<a id="still-stuck"></a>

## 5. Still stuck

1. `mimi-seed doctor` — the twelve-credential report and the fix command for each.
2. Ask your agent for `mimi_seed_status` — same idea, plus live OAuth freshness.
3. File an issue with the **error code** and what you were doing.

**Never paste a token, a `.p8`, or a service-account JSON into an issue, a chat, or a log.** If you already did:
revoke it in the vendor console before doing anything else.
