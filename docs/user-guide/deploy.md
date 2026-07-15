# End-to-End Deploy

`mimi-seed deploy` connects a CI build, readiness, Git-based release notes, and store application.

```text
CI build → resolve build number → readiness → release notes → store apply/promote
```

## Before you start

- Register the app with `mimi-seed init`
- Connect credentials for the target store
- If using CI, complete [Build and CI](build-ci.md)
- Run `mimi-seed check` and provider-specific risk checks
- Know the Android versionCode or iOS build number
- Resolve unpublished Console edits

## 1. Always start with dry-run

Android with a build:

```bash
npx mimi-seed deploy \
  --platform android \
  --ci github \
  --workflow deploy.yml \
  --ref main \
  --version-code 142 \
  --dry-run
```

If the build already exists:

```bash
npx mimi-seed deploy \
  --platform android \
  --skip-build \
  --version-code 142 \
  --dry-run
```

Run iOS separately with `--platform ios`.

## 2. Commit range and language

Specify the release-note range to avoid unrelated commits.

```bash
npx mimi-seed deploy \
  --platform android \
  --skip-build \
  --version-code 142 \
  --from v2.3.0 \
  --to HEAD \
  --language ko-KR \
  --dry-run
```

AI release notes require `ANTHROPIC_API_KEY`. You can generate and inspect only the notes with `mimi-seed notes`.

## 3. Run for real

After reviewing the dry-run, target app, versionCode/build, track or review target, and release notes, remove
`--dry-run`.

```bash
npx mimi-seed deploy \
  --platform android \
  --skip-build \
  --version-code 142 \
  --from v2.3.0 \
  --to HEAD \
  --language ko-KR
```

An interactive terminal asks before production/review work. `--yes` skips that confirmation and belongs only in
automation with a prior human review. Non-interactive jobs must enforce dry-run and gates earlier instead of
expecting a prompt.

## 4. Full CLI deploy versus detailed MCP tools

- CLI `deploy`: run the opinionated end-to-end pipeline
- Play/App Store skills: control a specific promotion, screenshot replacement, or TestFlight build attachment
- `mimi-seed notes`: generate notes only, optionally applying with `--apply`
- `mimi-seed check`: run Remote readiness independently

If the full pipeline is not the right shape, use the stepwise tools in [Store operations](stores.md).

## 5. Verify completion

- Confirm the successful build and artifact in CI
- Inspect the Play edit/track/release state
- Inspect the App Store version, attached build, and review state
- Verify applied release notes for every locale
- Check whether review started and whether staged rollout matches the intended percentage
- Monitor until the version is actually available to users

A successful deploy log does not mean store approval or full public availability.

## Resume after failure

- Build failed: fix and rerun CI; continue with `--skip-build` once a good build exists
- Unknown versionCode: read it from CI/store and pass it explicitly
- Readiness blocker: fix and rerun `mimi-seed check`
- Store API rejection: rerun provider risk checks and use [Troubleshooting](../troubleshooting.md)
- Partial success: read current store state first and do not repeat already-applied steps
