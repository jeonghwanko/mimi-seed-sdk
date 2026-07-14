# Auth & credentials — the `~/.mimi-seed/` map

> ⚠️ **Highest-risk doc, and a public repo.** This is a *map of file locations and their roles only* — it
> contains **no secret values** and must never gain any. The files it points to hold real tokens and private
> keys: **never commit them, never paste their contents into chat, code, logs, or issues.** They live in the
> user's home dir, outside the repo, and stay there.
>
> SSOT: `packages/mcp-server/src/auth/*`, `packages/mcp-server/src/appstore/auth.ts`, the
> `*/setup-cli.ts` flows. Runtime call order for fixing missing auth is in
> [`../agent-guide.md`](../agent-guide.md) §1–§2.

> This is the **file map** — where each credential lives and which code reads it. How a *user* **obtains** one
> (which vendor console, which role, what to download) is [`../credentials.md`](../credentials.md), and
> `mimi-seed setup` walks them through it.

## Credential files (locations & roles)

All under `~/.mimi-seed/` (legacy `~/.preseed/` is still read as a fallback):

| File (location) | Role | Written by |
|---|---|---|
| `tokens.json` | Google OAuth token — covers Firebase, AdMob, Play Developer API, IAM, BigQuery, GA4, Search Console, Google Ads | `mimi-seed-auth` (`auth/cli.ts`) |
| `appstore.json` | App Store Connect API key material (issuer id + key id + `.p8`), signed into a short-lived JWT at call time | `mimi-seed-appstore-auth` (`appstore/setup-cli.ts`) |
| `play-service-accounts/<packageName>.json` | **Per-package** Play service account — wins over the default | `mimi-seed-playstore-auth` / `playstore_register_service_account` |
| `play-service-account.json` | Default / legacy Play service account — fallback when no per-package match | same |
| `bigquery-service-account.json` | BigQuery SA — exempt from Workspace reauth (`invalid_rapt`); OAuth is the fallback | `mimi-seed-bigquery-auth` |
| `jenkins.json`, `ci.json` | Jenkins / GitHub-GitLab CI connection config | `jenkins_save_config` / `ci_save_config` |
| `facebook.json`, `instagram.json` | Page / account access tokens for the social post tools (written `0600`) | `facebook_save_config` / `instagram_save_config` |
| `google-ads.json` | Google Ads developer token + customer id (note: **not** `googleads.json`) | `googleads_save_config` |
| `config.json` | CLI ↔ remote-MCP config (PAT prefix + endpoint) | `mimi-seed init` (`cli/src/config.ts`) |

> Treat every file above as a secret. A repo `.gitignore` should keep them out even if a user runs the CLI
> inside a project; the SDK itself never writes them into the repo tree.

## The three auth models

| Provider | Mechanism | Where in code |
|---|---|---|
| **Google** (Firebase / AdMob / Play / IAM / BigQuery / GA4 / GSC / Ads) | One OAuth token in `tokens.json`; `ensureFreshAccessToken()` refreshes it before use | `auth/google-auth.ts` |
| **Apple** (App Store Connect) | API key (`issuer-id`, `key-id`, `.p8` private key) → ES256 **JWT** minted per request with `jose`, short TTL | `appstore/auth.ts` |
| **Google Play releases** (write) | A **service-account JSON** (not the user OAuth token); per-package resolution below | `auth/playstore-auth.ts` |

- **Per-package Play SA wins over the default.** Different apps can use SAs from different GCP projects;
  `playstore_list_service_accounts` shows the mapping. Resolution: look up
  `play-service-accounts/<packageName>.json` first, else fall back to `play-service-account.json`.
- The Play SA's **GCP project must have the Android Publisher API enabled**, or every `playstore_*` call returns
  `403` (this is *not* a permissions gap — see [[external-apis]] and [[pitfalls]]).
- **AI tools** (`generate_release_notes_from_commits`, `generate_review_reply`) read `ANTHROPIC_API_KEY` from the
  **environment**, not from `~/.mimi-seed/`.

## Setup sub-CLIs

Each setup flow is both a `bin` in `mcp-server/package.json` and an entry in the `SUBCOMMANDS` map
([[architecture]]). Run them directly when a credential is missing:

```
npx -y @yoonion/mimi-seed-mcp mimi-seed-auth            # Google OAuth → tokens.json
npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth   # ASC API key → appstore.json
npx -y @yoonion/mimi-seed-mcp mimi-seed-playstore-auth  # Play service account
npx -y @yoonion/mimi-seed-mcp mimi-seed-bigquery-auth   # BigQuery auth
```

The CLI also wraps Google login as `mimi-seed auth login` (`cli/src/auth.ts`). The MCP resource
`mimi-seed://auth/status` reports Google OAuth freshness as JSON; `mimi_seed_status` scans all services.

## Local to remote credential sync

`mimi_seed_remote_sync_credentials` bridges reusable local Store credentials into the remote HTTP MCP:

- Its default call is a preview and performs no network write.
- `confirm=true` uploads the App Store Connect key and per-package Play service-account JSON over the
  configured HTTPS MCP endpoint. The remote validates each credential against the provider before encrypted
  storage and never returns the secret material.
- `tokens.json` is deliberately excluded. A Google refresh token is bound to the local OAuth client and is not
  a portable remote credential. Remote Firebase, AdMob, and Android vitals therefore still require one Google
  platform-consent flow in the web console.
- The remote PAT and endpoint come from `config.json` or `MIMI_SEED_TOKEN` / `MIMI_SEED_WEB_BASE`.

Agents must preview first, explain the external secret storage, and obtain explicit user approval before a
second call with `confirm=true`.

## When writing auth code (do / don't)

- ✅ Resolve credentials through the existing helpers (`ensureFreshAccessToken`, the Play SA resolver, the ASC
  JWT minter). Don't re-read `~/.mimi-seed/*.json` ad hoc in a new tool.
- ✅ Surface the **raw provider reason** on `401`/`403` via the friendly-error layer ([[external-apis]]).
- ❌ Never log, echo, return, or embed a token / key / `.p8` / SA JSON — not in tool output, not in error
  messages, not in tests. Tests use placeholder fixtures only.
- ❌ Never add real issuer/key IDs, SA emails (`*@*.iam.gserviceaccount.com`), or project IDs to docs or
  fixtures. Use placeholders: `<packageName>`, `com.example.app`, `<service-account>@<project>.iam.gserviceaccount.com`.
