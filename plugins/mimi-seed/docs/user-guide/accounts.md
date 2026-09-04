# Connect Accounts

Mimi Seed stores provider credentials under `~/.mimi-seed/` in the user's home directory. It does not create
token files inside the app repository.

## Fastest path

```bash
npx mimi-seed setup
npx mimi-seed auth status --all
```

You can connect or reconnect one account at a time.

```bash
npx mimi-seed auth login       # Google OAuth
npx mimi-seed auth appstore    # App Store Connect API key
npx mimi-seed auth playstore   # Play service account
npx mimi-seed auth bigquery
npx mimi-seed auth jenkins
npx mimi-seed auth ci
npx mimi-seed auth googleads
npx mimi-seed auth meta        # Facebook + Instagram + Threads
```

The exact vendor-console steps and prerequisites live in the [credential reference](../credentials.md).

## Minimum accounts by task

| Task | Required connection |
|---|---|
| Remote status and readiness | Mimi Seed PAT (`mimi-seed init`) |
| Firebase, AdMob, GA4, GSC, IAM | Google OAuth |
| Play Store writes and releases | Google OAuth + a Play service account authorized for the app |
| App Store Connect and TestFlight | App Store Connect API key |
| CI build | GitHub/GitLab CI or Jenkins |
| AI release notes and review drafts | `ANTHROPIC_API_KEY` |
| Story-based video production | `ANTHROPIC_API_KEY` plus only the provider keys used: `YOUTUBE_API_KEY`, `PEXELS_API_KEY`, `OPENAI_API_KEY`; FFmpeg for rendering |
| Social publishing | Only the Facebook/Instagram/Threads accounts you use |

## App Store Connect details

```bash
npx mimi-seed auth appstore
```

The setup asks for the Issuer ID, Key ID, `.p8` path, and an optional digits-only Vendor Number. It verifies a
new API key with Apple before saving. If a working configuration already exists, use Enter/`N` to leave it
unchanged, `y` to replace the primary key, or `v` to update only the Vendor Number. Replacing the primary key
preserves the saved Vendor Number and any separate reports key.

Use an App Manager key for metadata and release operations. Creating Analytics report requests needs Admin;
sales reports need Admin, Finance, or Sales and Reports. The Vendor Number appears under the Legal Entity Name
at the upper left of App Store Connect **Reports**. See the [credential reference](../credentials.md#app-store-connect)
for the full setup path.

## What is validated before saving

App Store Connect, Jenkins, Google Ads, Facebook, Instagram, and Threads setups call the provider before saving.
A rejected token is not persisted as a successful setup. After connecting Play, verify it with an account/app
read. App Store's base probe confirms app-list access; role-specific Analytics and sales access is confirmed by
the first read in that workflow.

## Expiry and reconnection

- Google OAuth refreshes before calls. If the refresh token dies, run `mimi-seed auth login --force`.
- Reconnect expired or revoked Facebook/Instagram tokens with the platform-specific auth command.
- Before expiry, `mimi-seed auth threads` first attempts to refresh the current Threads token. An expired token
  requires a new authorization.
- Meta tokens enter the `mimi-seed setup` reconnect plan seven days before estimated expiry.
- App Store JWTs are minted with a short lifetime from the saved API key for each request.

```bash
npx mimi-seed auth facebook
npx mimi-seed auth instagram
npx mimi-seed auth threads
```

## Check in CI

Do not open interactive prompts in automation.

```bash
npx mimi-seed setup --non-interactive --fail-on-missing
```

The command exits non-zero when required credentials are missing, so it can gate build and deploy jobs.

## Security

- Treat all of `~/.mimi-seed/` as secret.
- Never copy credential files into the project.
- Enter tokens directly in the terminal wizard instead of pasting them into an agent chat.
- If a credential leaks, revoke it at the provider before cleaning docs or logs.
- Preview remote credential synchronization first; use `confirm=true` only after approving external storage.

For specific recovery steps, see [Troubleshooting](../troubleshooting.md).
