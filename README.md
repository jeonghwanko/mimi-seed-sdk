<p align="center">
  <img src="hero.svg" width="900" alt="Mimi Seed — Your app launch & ops, handled." />
</p>

<p align="center">
  <a href="https://mimi-seed.pryzm.gg"><strong>🌐 Homepage</strong></a> &nbsp;·&nbsp;
  <a href="https://mimi-seed.pryzm.gg/workspace/api-tokens">🔑 Get API Token</a> &nbsp;·&nbsp;
  <a href="https://www.npmjs.com/package/@yoonion/mimi-seed-mcp">📦 npm</a> &nbsp;·&nbsp;
  <a href="README.ko.md">🇰🇷 한국어</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/mimi-seed"><img src="https://img.shields.io/npm/v/mimi-seed?label=mimi-seed&color=F59E0B" /></a>
  <a href="https://www.npmjs.com/package/@yoonion/mimi-seed-mcp"><img src="https://img.shields.io/npm/v/%40yoonion%2Fmimi-seed-mcp?label=%40yoonion%2Fmimi-seed-mcp&color=F59E0B" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-PolyForm--NC--1.0.0-blue" /></a>
</p>

---

How many tabs do you have open right now to ship one app?

Play Console · App Store Connect · Firebase · AdMob · Google Cloud IAM...  
Write release notes, check screenshot specs, reply to reviews, wire up Firebase — all in separate dashboards, all manual.

**Mimi Seed handles all of this through Claude Code or Codex conversation.**

```
"Is my app ready to ship?"
→ Readiness Score 87/100 · 2 blockers: missing 6.9" screenshots, What's New empty

"Write release notes from commits since the last tag, Korean and English, and push to Play Store"
→ 3 tones (concise / detailed / marketing) × 2 locales generated · Apply now?

"Reply to this 1-star review with an empathetic tone"
→ Draft ready · Review before posting?

"Add an Android app to Firebase and download google-services.json"
→ App created · Add SHA-1 fingerprint?
```

---

## 30-Second Setup

**Option A — Remote MCP** (recommended for status & readiness · requires web console account)

```bash
# 1. Create account: https://mimi-seed.pryzm.gg/auth/signin
# 2. Issue a PAT:   https://mimi-seed.pryzm.gg/workspace/api-tokens
# 3-a. Register in Claude Code:
claude mcp add --transport http mimi-seed https://mimi-seed.pryzm.gg/api/mcp \
  --header "Authorization: Bearer <PAT>"

# 3-b. Or register in Codex:
npx mimi-seed mcp codex --write
```

Done. Start talking to Claude Code or Codex.

> **Remote vs Local — pick by what you need.** Remote MCP exposes a **read & diagnostic** subset (readiness, blockers, drafts, checklist, publish screenshots) **plus workspace-shared BigQuery** — every workspace member queries BigQuery through one shared service account with **no personal key file** (see [Team-Shared BigQuery](#team-shared-bigquery-remote-mcp)). For full **store-write automation** — release-notes apply, screenshot upload, Firebase / AdMob / IAM (the 147 local tools below) — use **Option B (Local MCP)**.

(That's the 148 local tools, up from 147 — see [`docs/domain/tool-catalog.md`](docs/domain/tool-catalog.md).)

---

**Option B — Local MCP** (Google OAuth · runs on your machine)

```bash
# Claude Code
claude mcp add mimi-seed -- npx -y @yoonion/mimi-seed-mcp
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.mimi-seed]
command = "npx"
args = ["-y", "@yoonion/mimi-seed-mcp"]
enabled = true
```

```bash
# First-time auth (opens browser)
npx -y @yoonion/mimi-seed-mcp mimi-seed-auth
```

> ⚠️ **If Google shows "access_denied" / "unverified app" on first login:** the OAuth app is in testing mode, so only registered test users can sign in. Ask the operator to add your Google account (Cloud Console → OAuth consent screen → Test users), then retry `mimi-seed-auth`. Retrying without being added will never succeed.

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mimi-seed": {
      "command": "npx",
      "args": ["-y", "@yoonion/mimi-seed-mcp"]
    }
  }
}
```

Optional auth for more platforms:

```bash
npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth    # App Store Connect
npx -y @yoonion/mimi-seed-mcp mimi-seed-playstore-auth   # Play Store service account
npx -y @yoonion/mimi-seed-mcp mimi-seed-bigquery-auth    # BigQuery (Crashlytics export, etc.)
```

Enable AI features (release notes, review replies):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

---

**Option C — CLI project connect**

```bash
npx mimi-seed init   # auto-detect app → connect account → register MCP
```

Detects Expo · Gradle · Info.plist · pbxproj automatically, and drops `.claude/mimi-seed.md` plus `AGENTS.md` so Claude Code and Codex pick up the release workflow every session.

| Command | What it does |
|---------|--------------|
| `mimi-seed init` | Connect project (issue PAT + auto-register apps) |
| `mimi-seed status` | Connection status + app list |
| `mimi-seed auth` | Google OAuth (Firebase / AdMob / Play) — `login` / `status` / `refresh` / `logout` |
| `mimi-seed doctor` | Diagnose environment (token · Git · apps · CI) |
| `mimi-seed check` | Pre-release readiness check (score + blockers) |
| `mimi-seed notes` | AI release notes (git log → 3 tones → multi-locale → apply) |
| `mimi-seed review` | AI review-reply draft + post to Play Store |
| `mimi-seed deploy` | Full deploy pipeline (CI build → release notes → store) |
| `mimi-seed logout` | Remove local config |

---

## What Can It Do?

### Launch Readiness Check

Automatically scans your Play Store and App Store listings before release.

```
"What's missing before I can ship?"
```

- Listing completeness (title, description, keywords)
- Screenshot device coverage
- Build availability (internal track / TestFlight)
- Privacy policy, What's New

---

### AI Release Notes

git commits → user-friendly release notes → push to stores.

```
"Write release notes from commits since v2.1.0 in Korean and English, then apply to Play Store"
```

- 3 tones: concise / detailed / marketing
- Multiple locales in one shot (ko · en-US · ja · zh-TW …)
- Generate → review → apply in one flow

---

### AI Review Replies

```
"Reply to this 2-star review with a professional tone"
```

Tones: `friendly` · `professional` · `empathetic` · `brief`  
Post directly with `playstore_reply_review` after review.

> AI-generated replies are drafts. Always review before posting.

---

### Screenshot Spec Validation

Validate local files against store requirements before uploading.

```
"Do these screenshots meet the iPhone 6.9-inch spec?"
```

iOS: `APP_IPHONE_69` · `APP_IPHONE_67` · `APP_IPAD_PRO_3GEN_129`  
Android: `phoneScreenshots` · `sevenInchScreenshots` · `featureGraphic`

---

### Firebase & AdMob Automation

```
"Add Android and iOS apps to my-app project and download both config files"
"Create a banner ad unit"
"What's today's AdMob revenue?"
```

---

### Service Account End-to-End

Need a service account JSON for Play Store receipt verification on your server?

```
"Create a play-verifier service account in my-project and issue a JSON key"
```

Creates IAM account → issues key → walks you through Play Console permissions.

---

### One-Command Deploy

Drive the whole release from one command: CI build → blocker check → release notes → store apply.

```bash
npx mimi-seed deploy                          # Android, auto-detect CI
npx mimi-seed deploy --platform ios           # iOS
npx mimi-seed deploy --skip-build --version-code 142   # notes-only apply
```

Works with **Jenkins · GitHub Actions · GitLab CI** (auto-detected, or force with `--ci`).

---

### Team-Shared BigQuery (Remote MCP)

Give a whole team read-only BigQuery access (GA4 export analysis, etc.) with **one shared
service account** — no per-machine key files, and immune to the Google Workspace OAuth
reauth policy (`invalid_rapt`) that breaks personal tokens.

A workspace **owner/admin** registers the service account once (encrypted, workspace-scoped):

```
"Register a BigQuery service account for the workspace"
→ register_integration(provider="bigquery", key="serviceAccountJson", value=<SA key JSON>)
→ register_integration(provider="bigquery", key="projectId",          value="my-gcp-project")
```

Then every workspace member (invite them at `/workspace/members`, they issue a PAT at
`/workspace/api-tokens`) connects the **Remote MCP** and queries with no local key:

```bash
claude mcp add --transport http mimi-seed https://mimi-seed.pryzm.gg/api/mcp \
  --header "Authorization: Bearer <PAT>"
```

```
"List BigQuery datasets"                       # bigquery_list_datasets
"Run: SELECT COUNT(*) FROM `proj.ga4.events_*` WHERE ..."   # bigquery_run_query (SELECT/WITH only)
```

Members can **use** the SA for read-only queries but **cannot read the key back** (no tool
returns stored secret values), and write statements are blocked. Recommended IAM on the SA:
`roles/bigquery.jobUser` + `roles/bigquery.dataViewer`.

> Local MCP (Option B) also has `bigquery_*` tools, but those authenticate with **your own**
> `~/.mimi-seed` key/OAuth — the *shared* SA lives on the **Remote** endpoint.

---

### Project Manifest — per-teammate setup guidance

Drop a **`.mimi-seed.json`** at your repo root declaring the services the project needs.
`mimi_seed_status` (MCP) and `mimi-seed doctor` (CLI) read it and tell each teammate exactly
**what they're missing + the precise setup command** — instead of a generic scan.

```json
{
  "project": "my-app",
  "services": {
    "oauth":     { "required": true },
    "bigquery":  { "required": true, "projectId": "my-gcp-project", "dataset": "analytics_123",
                   "workspaceProvider": "bigquery" },
    "playstore": { "required": true, "packageName": "com.example.app" },
    "appstore":  { "required": true, "keyId": "ABC123", "issuerId": "..." },
    "jenkins":   { "required": false, "url": "https://jenkins.example.io" }
  }
}
```

A teammate who clones the repo just runs `mimi-seed doctor` (or asks the agent "what am I
missing?") and follows the ❌ items. `bigquery` reports honestly whether a service account
**or** OAuth fallback is present.

---

## Slash Commands (MCP Prompts)

Available in any MCP client (Claude Code, Codex, etc.) as native slash commands:

| Command | What it does |
|---------|--------------|
| `/mimi-seed:deploy` | Check blockers → generate release notes → apply to stores |
| `/mimi-seed:health` | Auth status + launch readiness summary |
| `/mimi-seed:review-inbox` | Fetch unanswered reviews → draft AI replies |

Plus MCP resources: `mimi-seed://auth/status` (token state) · `mimi-seed://agent/guide` (agent role definition).

---

## Skills & Agent Guide

Bundled skills (auto-loaded by the Claude Code / Codex plugin from [`skills/`](skills/)):

| Skill | Use it for |
|-------|-----------|
| `mimi-seed` | General entry — status → readiness → release notes → store apply |
| `playstore-publish` | Play Store listing, images, release notes, track promote |
| `appstore-publish` | App Store Connect What's New + screenshots |
| `deploy` | End-to-end: CI build → blocker check → notes → apply |

Building an agent on top of Mimi Seed? Read **[`docs/agent-guide.md`](docs/agent-guide.md)** —
how tools load (the deferred-tool / `ToolSearch select:` pattern), the right call order,
auth model, and which actions are irreversible.

Contributing to the SDK? The **domain ontology** in [`docs/domain/`](docs/domain/) maps the architecture, the
full tool catalog, the auth/credential model, and known pitfalls — start at
[`docs/domain/_index.md`](docs/domain/_index.md).

---

## Local MCP Tool List (148 tools · 17 domains)

> These run via **Option B (Local MCP)** — Google OAuth on your machine. The Remote MCP (Option A) exposes a smaller read/diagnostic subset. Always-current catalog: [`docs/domain/tool-catalog.md`](docs/domain/tool-catalog.md).

| Domain | Count | Key Tools |
|--------|-------|-----------|
| **App Store Connect** | 31 | `appstore_submit_for_review` · `appstore_upload_screenshot` · `appstore_update_whats_new` |
| **Google Play** | 28 | `playstore_submit_release` · `playstore_replace_images` · `playstore_reply_review` |
| **Firebase** | 20 | `firebase_create_project` · `firebase_create_android_app` · `firebase_get_android_config` |
| **AdMob** | 7 | `admob_create_ad_unit` · `admob_get_today_earnings` · `admob_get_report` |
| **CI/CD** | 6 | `ci_trigger_build` · `ci_get_build_status` · `ci_list_workflows` (GitHub Actions · GitLab) |
| **Jenkins** (credentials) | 6 | `jenkins_create_credential` · `jenkins_upload_keystore` · `jenkins_save_config` |
| **GA4** | 6 | `ga4_create_property` · `ga4_create_data_stream` · `ga4_run_report` |
| **Search Console** | 6 | `gsc_inspect_url` · `gsc_search_analytics` · `gsc_submit_sitemap` |
| **Google Ads** | 6 | `googleads_list_campaigns` · `googleads_get_uac_report` · `googleads_get_campaign_report` |
| **Facebook** | 6 | `facebook_post_photo` · `facebook_post_multi_photo` · `facebook_list_pages` |
| **Google Cloud IAM** | 5 | `iam_create_service_account` · `iam_create_key` · `iam_add_iam_policy_binding` |
| **BigQuery** | 5 | `bigquery_run_query` · `bigquery_list_datasets` · `bigquery_get_table_schema` |
| **Checks / Risk** | 4 | `playstore_check_submission_risks` · `appstore_check_submission_risks` · `screenshot_validate` · `release_status` |
| **Instagram** | 4 | `instagram_post_image` · `instagram_post_carousel` · `instagram_save_config` |
| **Android signing** | 3 | `android_signing_setup` · `android_generate_keystore` · `jenkins_upload_playstore_sa` |
| **Auth** | 3 | `mimi_seed_status` · `mimi_seed_auth_start` · `mimi_seed_auth_status` |
| **AI** | 2 | `generate_release_notes_from_commits` · `generate_review_reply` |

Full catalog → [`docs/domain/tool-catalog.md`](docs/domain/tool-catalog.md) · source → [packages/mcp-server](packages/mcp-server)

---

## CI/CD Integration

Auto-generate and apply release notes on tag push:

```yaml
- name: Generate and apply release notes
  env:
    MIMI_SEED_TOKEN: ${{ secrets.MIMI_SEED_TOKEN }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    npx mimi-seed notes --apply --no-interactive --locale ko,en-US
    npx mimi-seed check --fail-on-blocker
```

Issue `MIMI_SEED_TOKEN` at [Dashboard → API Tokens](https://mimi-seed.pryzm.gg/workspace/api-tokens).

---

## Packages

| Package | Description |
|---------|-------------|
| [`mimi-seed`](packages/cli) | CLI — `npx mimi-seed init` to connect your project |
| [`@yoonion/mimi-seed-mcp`](packages/mcp-server) | Local MCP — 148 tools via Google OAuth |

Web console (Remote MCP): [mimi-seed.pryzm.gg/tool](https://mimi-seed.pryzm.gg/tool)

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MIMI_SEED_TOKEN` | PAT for CLI / CI headless mode |
| `MIMI_SEED_WEB_BASE` | Server base URL (default: `https://mimi-seed.pryzm.gg`) |
| `ANTHROPIC_API_KEY` | Enable AI release notes and review replies (optional) |

---

## Legacy Compatibility

Data from the Preseed era (`~/.preseed/`) is picked up automatically — no re-auth needed.

- Reads `~/.preseed/tokens.json` and `~/.preseed/appstore.json` if present
- Still honors `PRESEED_GOOGLE_CLIENT_ID` / `PRESEED_GOOGLE_CLIENT_SECRET`

New data is written to `~/.mimi-seed/`.

---

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — noncommercial use only.

Commercial licensing: [turbo08@gmail.com](mailto:turbo08@gmail.com)

**Required Notice:** Copyright 2026 Pryzm GG (https://mimi-seed.pryzm.gg)
