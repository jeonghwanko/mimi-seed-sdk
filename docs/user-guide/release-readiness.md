# Release Readiness

Readiness separates “can the API call work?” from “is the release complete enough for users and store review?”
before any real release.

## Two kinds of checks

| Check | What it covers |
|---|---|
| `mimi-seed check` | Remote app registration, integration, copy, screenshots, checklist, and blockers |
| Local MCP risk checks | Actual Play/App Store version, build, metadata, and submission conditions |

A high readiness score does not guarantee store approval. A low score is useful only when you act on its causes.

## 1. Basic check

```bash
npx mimi-seed check
```

Select an app when more than one is registered.

```bash
npx mimi-seed check --app <app-id>
```

Fail CI when blockers exist:

```bash
npx mimi-seed check --app <app-id> --fail-on-blocker
```

## 2. Provider-specific risk checks

Ask Claude/Codex:

```text
Run a read-only Play Store release risk check. Inspect tracks, the latest release, service-account access,
version code, and missing listing data. Do not release anything.
```

```text
Check App Store submission risks. Inspect the version, attached build, localizations, screenshots, and review
state, but do not submit.
```

The agent should use `playstore_check_submission_risks` or `playstore_plan_release`, and
`appstore_check_submission_risks` or `appstore_plan_release`.

## 3. Pre-release checklist

- App ID, package name, and bundle ID match the target app
- Android versionCode or iOS build is newer than the previous value
- Release-note locales match actual store locales
- Screenshot specifications and order are intentional
- Required pricing, territory, content-rating, and privacy fields are complete in the store
- Play/App Store credentials can access the correct app
- CI build and tests succeeded
- There are no unpublished Console edits that an API write would overwrite
- Internal testing is complete before production/review submission

## 4. Dry run

```bash
npx mimi-seed deploy \
  --platform android \
  --skip-build \
  --version-code <N> \
  --dry-run
```

Run Android and iOS separately. Success for one platform says nothing about the other.

After fixing blockers, repeat the same checks and continue to [End-to-end deploy](deploy.md).
