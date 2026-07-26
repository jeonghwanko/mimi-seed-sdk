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
- Release an approved version, change how it releases, or run a phased release (below)

### The review submission bundle — where resubmission actually gets stuck

App Store Connect does not submit a version directly. It submits a **review submission**: a bundle whose items
are the version, the in-app purchases, and anything else going to review together. Most "I can't resubmit"
situations are a bundle problem, not a version problem — the version can look perfectly fine in
`PREPARE_FOR_SUBMISSION` while an old bundle still holds it.

Start with `appstore_list_review_submissions`. It shows each bundle's state — `READY_FOR_REVIEW` (draft),
`WAITING_FOR_REVIEW` (queued), `UNRESOLVED_ISSUES` (rejected, unresolved), `COMPLETE` — and every item inside it.

| What you hit | What is actually wrong | Fix |
|---|---|---|
| `appStoreVersions ... is not in valid state` on resubmit | A rejected `UNRESOLVED_ISSUES` bundle still holds your version | Release the item with `appstore_remove_review_submission_item`; the old bundle then settles to `COMPLETE`. `appstore_submit_for_review` already tries this — intervene manually only when it can't |
| 409 `an appStoreVersions must be included in this review submission` | Adding IAPs in the web console created a **products-only** bundle | Move the version into that bundle with `appstore_add_version_to_review_submission`. If the version is held elsewhere, free it first: `appstore_remove_review_submission_item` for an unsubmitted bundle, `appstore_cancel_review` for a submitted one (items can't be removed from a submitted bundle) |
| 409 `cannot create a new version in the current state` | An editable version record already exists | Don't create another — rename the existing record with `appstore_update_version_string` (e.g. 2.0.5 → 2.0.6). Only works in editable states such as `PREPARE_FOR_SUBMISSION` / `DEVELOPER_REJECTED` |

A build attaches only to the version whose `CFBundleShortVersionString` matches, so fix the version string
**before** attaching the new build.

### After approval — releasing

Setting `releaseType` when you create the version (`MANUAL` / `AFTER_APPROVAL` / `SCHEDULED`) covers most cases:
`AFTER_APPROVAL` ships the moment Apple approves, with nothing left to do. The tools below cover what that
setting cannot.

| Situation | Tool |
|---|---|
| Read the version state, release type, and phased-release progress | `appstore_release_status` |
| A version sits in `PENDING_DEVELOPER_RELEASE` and you want it live now | `appstore_release_version` (`confirm: true` — irreversible) |
| You created the version as `MANUAL` and want it to ship on approval instead | `appstore_update_release_type` |
| Roll out over Apple's 7-day ramp, pause it, resume it, or push it to everyone | `appstore_phased_release` |

`appstore_phased_release` takes `status` / `enable` / `pause` / `resume` / `complete` / `disable`. Pause and
resume are reversible; `complete` and `disable` release to every remaining user at once and require
`confirm: true`. This is the iOS counterpart to Play's `userFraction` / `halted` staged rollout.

### App Store-specific risks

- Mimi Seed does not create the binary or perform its first upload to App Store Connect. CI/Xcode must upload it.
- Do not attach a build while it is still `PROCESSING`.
- Submission depends on version, build, metadata, export-compliance, and other required Console state.
- Re-read current state and explicitly confirm screenshot-set deletion or review cancellation.
- Cancelling a submitted bundle takes the whole bundle out of review, not just one item.

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
