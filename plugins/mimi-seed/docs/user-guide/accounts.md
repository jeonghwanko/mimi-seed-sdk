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

## What is validated before saving

Jenkins, Google Ads, Facebook, Instagram, and Threads setups call the provider before saving. A rejected token
is not persisted as a successful setup. After connecting Play or App Store, verify it with an account/app read.

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
