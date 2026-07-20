# Social Publishing

Mimi Seed can publish release announcements and images to Facebook Pages, Instagram professional/creator
accounts, and Threads accounts. They are all Meta platforms, but they do not share identical account or token
requirements.

## Supported surface

| Platform | Supported | Limitation |
|---|---|---|
| Facebook | One Page photo, multi-photo with 2–10 images | Not personal-profile posting |
| Instagram | One image, carousel with 2–10 images | Business/creator account; no Reels, video, or Stories |
| Threads | Text, one image, carousel with 2–20 images | 500-character text; separate token from Instagram |

Every image post requires a **public HTTPS URL** that Meta can fetch. Local paths, intranet URLs, authenticated
URLs, and expired signed URLs do not work.

## 1. Connect accounts

```bash
npx mimi-seed auth meta
npx mimi-seed auth status --all
```

Or connect only what you use:

```bash
npx mimi-seed auth facebook
npx mimi-seed auth instagram
npx mimi-seed auth threads
```

For multiple accounts, save named profiles and map them per project:

```bash
npx mimi-seed auth instagram --profile my-app
npx mimi-seed auth threads --profile my-app
```

```json
{ "socialProfiles": { "instagram": "my-app", "threads": "my-app" } }
```

Put the JSON in the project's `.mimi-seed.json`. The mapping is automatic; an explicit MCP `profile` argument
overrides it. With no mapping, the existing default account files continue to work.

See the [credential reference](../credentials.md#facebook) for token and account-type requirements.

## 2. Verify the target before posting

Ask Claude/Codex:

```text
Read the connected Facebook Page, Instagram account, and Threads account. Show only username and ID. Do not post.
```

The agent should validate the live API connection with `facebook_get_page`, `instagram_get_account`, and
`threads_get_account`.

## 3. First posts

Threads text:

```text
Prepare this Threads post and show me the final preview first:
"Version 2.4 is live with a faster start screen and improved notification settings."
Do not publish until I confirm.
```

Instagram image:

```text
I plan to post https://cdn.example.com/releases/2.4.0/launch.jpg to Instagram. Improve the caption, verify the
image URL and target account, and show only a preview.
```

Facebook multi-photo:

```text
Prepare a Facebook multi-photo release announcement from these three public URLs. Show the order and copy first,
and publish only after confirmation.
```

## 4. Verify a published post

Keep the returned media ID and permalink. Permalink lookup is best-effort and may be empty; inspect the latest
post in the platform when necessary. Images and carousels can take several seconds to process.

## Token expiry

- Facebook/Instagram: reconnect with the exact `mimi-seed auth <platform>` command in the error
- Threads before expiry: run `mimi-seed auth threads` or `threads_refresh_token`
- Expired/revoked Threads token: authorize a new token
- `mimi-seed setup` flags Meta credentials seven days before estimated expiry

Meta OAuth code 190 and 401 responses are translated into an exact recovery command instead of only raw text.

## Operations checklist

- Confirm target account and Page name
- Review text, mentions, hashtags, and links
- Open image URLs while logged out
- Check carousel order and platform item limits
- Align public post timing with actual store availability
- Record returned IDs to avoid duplicate posting
- Verify rendering and links in the platform after publishing

## Failure recovery

- URL fetch failure: verify public HTTPS, Content-Type, and signed-URL lifetime
- Wrong account type: confirm Instagram professional/creator status and permissions
- Missing permission: check Meta app permissions and the user's role on the target Page/account
- Media timeout: check the platform before retrying, or you may create a duplicate post
- Text/item limit: reduce copy or images and produce a new preview
