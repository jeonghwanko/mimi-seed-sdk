# Social setup checklist

One page for the first-time setup of the posting channels: YouTube, Facebook, Instagram, Threads, and TikTok.
Set up only the ones you will post to. Each step links to the full instructions in the
[credential reference](../credentials.md).

The setup has three parts:

1. **Prepare** — one-time work in each platform's developer console. This is the slow part.
2. **Connect** — one command.
3. **Verify** — one command.

## 1. Prepare (once per platform)

### Common

- [ ] Mimi Seed is installed and runs ([Getting started](getting-started.md)).
- [ ] **Google sign-in works** (`npx mimi-seed auth login`). YouTube reuses this sign-in's OAuth client, so do it
      first even if you only want YouTube (or set `MIMI_SEED_GOOGLE_CLIENT_ID` and `MIMI_SEED_GOOGLE_CLIENT_SECRET`).

### YouTube — [details](../credentials.md#google-oauth)

- [ ] In your Google Cloud project, **YouTube Data API v3** is enabled.
- [ ] You know which Google account owns the channel. It may differ from the account you use for Play and Firebase;
      Mimi Seed keeps it in a separate `youtube` profile.
- [ ] **That** account is listed under **OAuth consent screen → Test users**.

### Facebook — [details](../credentials.md#facebook)

- [ ] You have a Meta developer app ([developers.facebook.com](https://developers.facebook.com/apps)).
- [ ] You are an **admin** of the Page you will post to.
- [ ] In Graph API Explorer, you generated a **User** token with `pages_show_list`, `pages_manage_posts`, and
      `pages_read_engagement`, then **extended** it in the Access Token Debugger (*Extend Access Token*).
- [ ] With the extended token, you called `/me/accounts` and copied your Page's `access_token` (`EAA…`). A Page token
      made from an unextended user token stops working after about an hour.

### Instagram — [details](../credentials.md#instagram)

- [ ] The account is an Instagram **professional account** (Business or Creator). A personal account cannot post
      through the API.
- [ ] In your Meta app, the use case **Manage messaging & content on Instagram → API setup with Instagram login** is
      added.
- [ ] Under **Set up Instagram business login**, the redirect URI `https://localhost:8765/callback` is registered.
- [ ] You have the **Instagram app ID and app secret** from that screen. They are not the Meta app ID.
- [ ] Your account is added under **App roles → Instagram Testers**, and you accepted the invite in Instagram.

No App Review is needed to post to your own account.

### Threads — [details](../credentials.md#threads)

- [ ] A Meta app has the use case **Access the Threads API** (add it to your Instagram app, or create a separate app
      if Meta does not offer it there).
- [ ] Under its settings, the redirect URI `https://localhost:8765/callback` is in **Redirect Callback URLs**, and
      the **Uninstall** and **Delete** callback URLs are filled in. Meta will not save the form without them.
- [ ] You have the **Threads app ID and app secret** from that screen.
- [ ] Your account is a **Threads Tester**, and you accepted the invite at threads.net → Settings → Website
      permissions.

### TikTok — [details](../tiktok-business-setup.md)

TikTok is the only platform here that needs an **app review**, so start it first if you want TikTok.

- [ ] Your app in the [TikTok API for Business portal](https://business-api.tiktok.com/portal) has Organic API
      access approved, with **Video Publish** enabled.
- [ ] You have the app's **Client ID** (App ID) and **Client Secret**, and its redirect URL is configured.
- [ ] The domain that will host your videos is verified for the app.
- [ ] You know how to produce an `auth_code` (the account-holder authorization link). **Do not make it yet:** it is
      valid for 10 minutes, and TikTok comes last in the wizard. Generate it when the wizard reaches TikTok.

## 2. Connect (one command)

```bash
npx mimi-seed auth social
```

Run it in a terminal (in Git Bash, add `--interactive`). It goes through YouTube, Facebook, Instagram, Threads, and
TikTok in turn, and skips anything already connected. At each platform:

| Key | Does |
|---|---|
| `c` | Connect it now |
| `s` or Enter | Skip it for now |
| `?` | Show where to get what it asks for |
| `q` | Stop here (run the command again later to continue) |

For Instagram and Threads, a browser opens. After you approve, the page may fail to load. That is expected: copy
the full address-bar URL and paste it into the terminal.

## 3. Verify

```bash
npx mimi-seed auth status --all
```

Each platform you connected shows `✓`. Then ask your agent: "Show the connected social accounts. Do not post."

## Things that expire

| Platform | What expires | What to do |
|---|---|---|
| Facebook, Instagram, Threads | Tokens after about 60 days | `npx mimi-seed setup` flags them 7 days ahead and reconnects them |
| YouTube | Sign-in after 7 days while the Google app is in **Testing** | Set the consent screen to **In production** to remove the limit |
| TikTok | The refresh token after one year | Run `npx mimi-seed auth tiktok` with a new `auth_code` |

## If you get stuck

| Symptom | Fix |
|---|---|
| Google says "access blocked" / `access_denied` | Add your account under **OAuth consent screen → Test users** |
| A Google call fails with `SERVICE_DISABLED` | Enable that API in the Google Cloud project, then retry |
| Instagram or Threads: "Could not exchange the authorization code" | The app ID, app secret, and redirect URI must match the dashboard exactly, including a trailing `/`. Re-enter them with `--reset-app` |
| Facebook posting stops about an hour after connecting | The Page token came from an unextended user token. Extend the user token, copy the Page token again, and run `npx mimi-seed auth facebook` |
| Threads settings will not save | Fill in the Uninstall and Delete callback URLs too |
| Instagram login fails for your account | Accept the tester invite, and use a Business or Creator account |

More recovery steps: [Troubleshooting](../troubleshooting.md).
