# Repeat Release Doctor checks in CI

Run a local check and review the findings first. Then add this workflow to your mobile repository as
`.github/workflows/release-doctor.yml`. It checks pull requests and rechecks the default branch weekly.

```yaml
name: Release Doctor
on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: '23 3 * * 1'
  workflow_dispatch:
permissions:
  contents: read
jobs:
  readiness:
    uses: jeonghwanko/mimi-seed-sdk/.github/workflows/release-doctor.yml@main
    with:
      project-path: .
      cli-version: latest
```

For reproducible production checks, pin the reusable workflow to a reviewed commit SHA and `cli-version`
to an exact stable version. `latest` includes newly shipped policy rules; a weekly schedule with a pinned
CLI only reevaluates the rules already in that version. Use your actual default branch name.

The workflow runs without store keys, project dependency installation, source-code execution or telemetry.
It prints the local report to CI logs; review your repository's log visibility because reports contain paths
and app identifiers. It does not upload raw JSON artifacts or write comments on pull requests.

Add a workflow-status badge, replacing OWNER and REPO with your repository:

```markdown
[![Release Doctor](https://github.com/OWNER/REPO/actions/workflows/release-doctor.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/release-doctor.yml)
```

This badge means the workflow passed, not that a store has approved the app. A blocker fails the job;
an unresolved warning needs review. Commercial use requires a separate license.
