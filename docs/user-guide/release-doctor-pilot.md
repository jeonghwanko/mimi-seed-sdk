# Release Doctor Pilot

This pilot measures whether Release Doctor finds a useful release risk before it asks for any store account.
It is for noncommercial use under the repository's current license, including eligible open-source use. Commercial evaluation
requires separate written permission.

See the [public-repository validation baseline](release-doctor-validation.md) for the preflight results that
preceded this pilot.

## Ten-minute protocol

1. Run from the mobile app root. In a monorepo, pass the app directory with `--path`.

   ```bash
   npx -y mimi-seed@latest check --local --json
   ```

2. Record approximate cold-run and warm-run times. The cold run may download the CLI package; the checker itself
   is bundled and does not launch a second npx install.
3. Compare the finding codes with blockers you already know from Play Console, App Store Connect, or the build.
4. Do not publish the raw JSON. It can contain absolute local paths and app identifiers.
5. Submit only redacted counts, finding codes, framework, and timing through the
   [Release Doctor pilot form](https://github.com/jeonghwanko/mimi-seed-sdk/issues/new?template=release-doctor-pilot.yml).

## What success means

- The correct mobile platform is detected.
- A known Target API or Billing blocker is reported without a false blocker.
- The user gets a useful result without connecting a store account.
- The first result arrives quickly enough that the user does not abandon the command.

The report is repository-only evidence. It does not guarantee store approval and does not replace connected
metadata, uploaded-build, declaration, or submission-state checks.

## CI trial

Use the blocker exit code only after reviewing the first report. Pin an exact package version when moving from
the pilot to a production branch.

```yaml
- name: Mimi Seed Release Doctor
  run: npx -y mimi-seed@latest check --local --fail-on-blocker
```
