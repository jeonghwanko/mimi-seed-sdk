# Auth & credentials — the `~/.mimi-seed/` map

> ⚠️ **Highest-risk doc, and a public repo.** This is a *map of file locations and their roles only* — it
> contains **no secret values** and must never gain any. The files it points to hold real tokens and private
> keys: **never commit them, never paste their contents into chat, code, logs, or issues.** They live in the
> user's home dir, outside the repo, and stay there.
>
> SSOT: `packages/mcp-server/src/auth/*`, `packages/mcp-server/src/appstore/auth.ts`, the
> `*/setup-cli.ts` flows. Runtime call order for fixing missing auth is in
> [`../agent-guide.md`](../agent-guide.md) §1–§2.

## Credential files (locations & roles)

All under `~/.mimi-seed/` (legacy `~/.preseed/` is still read as a fallback):

| File (location) | Role | Written by |
|---|---|---|
| `tokens.json` | Google OAuth token — covers Firebase, AdMob, Play Developer API, IAM, BigQuery, GA4, Search Console, Google Ads | `mimi-seed-auth` (`auth/cli.ts`) |
| `appstore.json` | App Store Connect API key material (issuer id + key id + `.p8`), signed into a short-lived JWT at call time | `mimi-seed-appstore-auth` (`appstore/setup-cli.ts`) |
| `play-service-accounts/<packageName>.json` | **Per-package** Play service account — wins over the default | `mimi-seed-playstore-auth` / `playstore_register_service_account` |
| `play-service-account.json` | Default / legacy Play service account — fallback when no per-package match | same |
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

## When writing auth code (do / don't)

- ✅ Resolve credentials through the existing helpers (`ensureFreshAccessToken`, the Play SA resolver, the ASC
  JWT minter). Don't re-read `~/.mimi-seed/*.json` ad hoc in a new tool.
- ✅ Surface the **raw provider reason** on `401`/`403` via the friendly-error layer ([[external-apis]]).
- ❌ Never log, echo, return, or embed a token / key / `.p8` / SA JSON — not in tool output, not in error
  messages, not in tests. Tests use placeholder fixtures only.
- ❌ Never add real issuer/key IDs, SA emails (`*@*.iam.gserviceaccount.com`), or project IDs to docs or
  fixtures. Use placeholders: `<packageName>`, `com.example.app`, `<service-account>@<project>.iam.gserviceaccount.com`.
