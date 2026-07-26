# Set up TikTok Business Organic API

This guide connects Mimi Seed's `tiktok_business_*` tools to an **owned TikTok Business Account** for public
video publishing. It is not the Marketing API long-term-token flow or the Login Kit flow at
`developers.tiktok.com`.

> Never paste a Client Secret, `auth_code`, access token, or refresh token into a repository, chat, or issue.
> `mimi-seed auth tiktok` stores them locally in `~/.mimi-seed/tiktok-business.json` with mode `0600`.

## Prerequisites

- An owned TikTok Business Account that will receive the posts
- Access to the [TikTok API for Business portal](https://business-api.tiktok.com/portal)
- A public HTTPS callback endpoint on a domain you control
- App metadata required by the Organic API review
- An HTTPS domain or URL prefix that can be verified for hosted publishing videos

## The four wizard values

| Mimi Seed input | Where it comes from | Important detail |
|---|---|---|
| Client ID | My Apps → App Detail → Basic Information → App ID | Public app identifier |
| Client Secret | Secret on the same page | Keep it private |
| Redirect URI | A callback URL that you operate | Must exactly match the app setting |
| `auth_code` | Callback query after the account owner approves | Single-use and valid for 10 minutes |

The official token endpoint exchanges these values for a one-day access token and a one-year refresh token.
Mimi Seed refreshes the access token five minutes before expiry.

## 1. Create and submit the developer app

1. Sign in to the [TikTok API for Business portal](https://business-api.tiktok.com/portal).
2. Complete developer registration.
3. Open **My Apps → Create App** and create an app for owned-account Organic publishing.
4. Describe the real use case: publishing and reconciling Organic content on an owned Business Account.
5. Request Organic API access and submit the app for review.

After approval, find the App ID and Secret under **My Apps → App Detail → Basic Information**.

## 2. Request the minimum permissions

Enable at least:

- **TikTok Accounts → Business Content → Video Publish**
- **TikTok Accounts → Business User → Get Business User Basic info**

Video Publish covers publishing and status reconciliation. Basic info lets Mimi Seed verify the selected account
with `/business/get/` immediately after token exchange. Mimi Seed refuses to publish when the granted token scope
does not include `video.publish`.

## 3. Configure the Redirect URI

TikTok does not issue this value. Operate a public HTTPS callback such as:

```text
https://<your-domain>/oauth/tiktok/callback
```

The callback must be internet-accessible, return successfully, avoid logging the query or `auth_code`, and use
the exact same URI in the app, authorization request, and Mimi Seed wizard. Scheme, host, path, case, and a
trailing slash can all affect matching. Do not use third-party webhook inspection services. If the authorization
flow uses `state`, verify that the returned value matches.

## 4. Authorize the target account

1. In the app's Accounts/Organic API authorization area, generate or copy the **TikTok account-holder
   authorization URL**.
2. Open it and sign in as the actual target TikTok Business Account.
3. Review and approve the account and permissions.
4. Copy the `auth_code` from the callback URL.

```text
https://<your-domain>/oauth/tiktok/callback?auth_code=<one-time-code>&state=<state>
```

Copy only the value after `auth_code=` and before the next `&`. It is valid for 10 minutes and can be used once.

## 5. Connect Mimi Seed

Run this in a private terminal without screen sharing or session recording:

```bash
mimi-seed auth tiktok
```

Enter the Client ID, Client Secret, exact Redirect URI, and fresh one-time `auth_code`. Mimi Seed exchanges the
code, checks `video.publish`, verifies access to the Business Account, and writes the local credential file.

Check credential presence without displaying secrets:

```bash
mimi-seed auth status --all
```

Then start a new Claude/Codex session and request a read-only check:

```text
Check the TikTok Business connection and target account. Do not publish anything.
```

The agent should call `tiktok_business_auth_status` and `tiktok_business_get_account` first.

## 6. Verify the hosted-video URL property

Authentication does not verify the publishing URL. `video_url` must use an app-verified HTTPS domain or URL
prefix, be fetchable without login or cookies, return video bytes directly with 2xx rather than a 3xx redirect,
and remain valid while TikTok fetches it (at least 30 minutes is recommended for signed URLs).

The local source file is only for ffprobe validation and SHA-256 duplicate detection. Host the same video at a
verified URL before creating a post plan.

## Troubleshooting

| Symptom | Check |
|---|---|
| Redirect URI mismatch | Compare scheme, host, path, case, and trailing slash with the app setting |
| Invalid or expired code | Authorize again and use the fresh code once within 10 minutes |
| Missing `video.publish` | Check app permission approval and authorization URL scopes |
| `/business/get/` failure | Check the basic-info permission and that the approved account is a Business Account |
| App remains pending | Review App Detail authorization/review status and TikTok support notifications |
| Connected but publish fails | Check URL-property verification, direct 2xx response, and signed-URL lifetime |

Do not repeatedly submit the same failed `auth_code`. Obtain a new code. If a publishing POST times out, reconcile
TikTok and the local Mimi Seed audit before retrying.

## Official references

- [TikTok API for Business portal](https://business-api.tiktok.com/portal)
- [Create a developer app](https://business-api.tiktok.com/portal/docs/create-an-app/v1.3)
- [API v1.3 endpoints and permission scopes](https://business-api.tiktok.com/gateway/docs/index?doc_id=1735713875563521&language=ENGLISH)
- [Obtain a short-term access token](https://business-api.tiktok.com/gateway/docs/index?doc_id=1833997638479041&language=ENGLISH)
