# Store Operations

Use this guide when you need a specific store operation instead of the full deploy pipeline. The
`playstore-publish` and `appstore-publish` skills in Claude Code and Codex enforce a read → plan → write order.

## Shared operating pattern

1. Read the target app and current state.
2. Produce a risk check or release plan.
3. Preview the locales, track, version, and image list that will change.
4. Write only after user confirmation.
5. Read again to verify the applied state.

## Google Play

### Prerequisites

- Package name
- A Play service account authorized for that app
- Android Publisher API enabled in the service account's GCP project
- An app already created in Play Console
- A build containing the versionCode to release

### Typical read sequence

```text
playstore_get_app
→ playstore_list_tracks
→ playstore_get_listing
→ playstore_plan_release or playstore_check_submission_risks
```

Then perform only the required work:

- Update listings and developer details
- Apply localized release notes
- Inspect, upload, or replace screenshots
- Release or promote internal/test/production tracks
- Read and reply to reviews
- Inspect and manage one-time products and subscriptions

### Play-specific risks

- Committing an API edit can discard unpublished changes saved in the Console UI.
- Draft apps have different track restrictions before their first external publish. Non-internal tracks may reject
  `completed` status.
- Production promotion and full rollout are near-irreversible. Reconfirm version and track.
- Read the current image list and preview the replacement before replacing or deleting all images.
- A service-account 403 can mean the GCP API is disabled, not only missing Play permissions.

## App Store Connect

### Prerequisites

- An App Store Connect app linked to the bundle ID
- An API key with the required role
- A processed build already uploaded by CI/Xcode
- A new version number and localized metadata

### Typical read sequence

```text
appstore_list_apps
→ appstore_list_versions
→ appstore_list_builds
→ appstore_get_metadata
→ appstore_plan_release or appstore_check_submission_risks
```

Continue with only the needed steps:

- Create a version
- Update What's New and localizations
- Upload or delete screenshots
- Attach the latest or a selected build
- Inspect TestFlight groups and builds
- Manage review notes and review screenshots
- Reply to reviews
- Manage in-app products, subscriptions, and product review information
- Submit for review or cancel a submission

### App Store-specific risks

- Mimi Seed does not create the binary or perform its first upload to App Store Connect. CI/Xcode must upload it.
- Do not attach a build while it is still `PROCESSING`.
- Submission depends on version, build, metadata, export-compliance, and other required Console state.
- Re-read current state and explicitly confirm screenshot-set deletion or review cancellation.

## Prompt examples

```text
Read the current Play production state and make a plan for releasing the new versionCode. Do not create an edit
or promote anything.
```

```text
Inspect the next App Store version and processed builds. Tell me which localizations and screenshots are missing.
Do not submit for review.
```

```text
Apply only the reviewed ko-KR and en-US release notes, then read them back to verify.
```

For the full pipeline, see [End-to-end deploy](deploy.md). For auth issues, see [Connect accounts](accounts.md).
