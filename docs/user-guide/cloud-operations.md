# Cloud and Analytics

Local MCP and the CLI connect Firebase, AdMob, GA4, BigQuery, Search Console, Google Ads, and Google Cloud IAM.
Most share Google OAuth, but each API has different permissions, cost, and risk.

## Firebase

Start with reads.

```bash
npx mimi-seed firebase projects
npx mimi-seed firebase apps --project <project-id>
```

Register apps and obtain config:

```bash
npx mimi-seed firebase create-android \
  --project <project-id> --package com.example.app --name "Example Android"

npx mimi-seed firebase create-ios \
  --project <project-id> --bundle com.example.app --name "Example iOS"

npx mimi-seed firebase config \
  --project <project-id> --app <firebase-app-id> --platform android
```

Enable common services and link Analytics:

```bash
npx mimi-seed firebase enable-services --project <project-id>
npx mimi-seed firebase link-analytics --project <project-id> --property <ga-property-id>
npx mimi-seed firebase analytics-details --project <project-id>
```

Firebase config output contains app configuration. Keep it out of public logs and apply it to the correct app
module. App deletion is destructive; reconfirm app ID and platform.

## AdMob

```bash
npx mimi-seed admob accounts
npx mimi-seed admob apps --account <account-id>
npx mimi-seed admob ad-units --account <account-id>
```

Accounts allowlisted for creation APIs can create apps and ad units.

```bash
npx mimi-seed admob create-app \
  --account <account-id> --platform ANDROID --name "Example" --store-id com.example.app

npx mimi-seed admob create-ad-unit \
  --account <account-id> --app <admob-app-id> --name "Launch Banner" --format BANNER
```

AdMob creation APIs may be Limited Access and return 403 for an otherwise valid account. Do not retry forever;
create it in AdMob Console, then use Mimi Seed for reads and reporting.

## GA4

```bash
npx mimi-seed ga4 accounts
npx mimi-seed ga4 properties --account <account-id>
npx mimi-seed ga4 streams --property <property-id>
```

Create properties/streams and run Data API reports.

```bash
npx mimi-seed ga4 report \
  --property <property-id> --start 28daysAgo --end today \
  --dimensions date,country --metrics activeUsers,eventCount
```

Admin work needs `analytics.edit`; reports need `analytics.readonly`. Reauthorize an older Google token with
`mimi-seed auth login --force`.

## BigQuery, Search Console, and Google Ads

- BigQuery: inspect datasets/tables/schemas and run queries. Estimate scan cost; begin with a narrow range and LIMIT.
- Search Console: inspect sites, sitemaps, indexing, and search performance; submit a sitemap.
- Google Ads: list accessible customers and read campaign/UAC reports. Developer-token level can restrict real accounts.

## IAM and service accounts

IAM tools can create service accounts, keys, and policy bindings. A private-key result is one-time sensitive
material. Do not print it in chat or logs; place it directly into the CI secret store. Use the least-privileged
role and revoke unused keys regularly.

## Operations prompt examples

```text
Read the Firebase projects and apps, then compare their Android package and iOS bundle IDs. Do not change data.
```

```text
Report GA4 activeUsers and eventCount by date for the last 28 days. Do not modify analytics configuration.
```

```text
Read today's AdMob earnings and ad units by app. Do not create a new ad unit.
```

For permission failures, see [Connect accounts](accounts.md) and [Troubleshooting](../troubleshooting.md).
