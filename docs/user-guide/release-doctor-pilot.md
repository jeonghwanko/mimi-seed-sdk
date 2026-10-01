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

   If `npx` stops with `npm error code EBADDEVENGINES` before Mimi Seed prints anything, the project's
   `package.json` declares `devEngines` (a Node or package-manager version), and npm enforces it for every `npx`
   run inside that directory. Release Doctor never started. Run it with a throwaway npm prefix, or from outside the
   repository:

   ```bash
   # macOS / Linux
   npx -y --prefix "$(mktemp -d)" mimi-seed@latest check --local --json --path .
   # or, from any directory outside the repository
   npx -y mimi-seed@latest check --local --json --path /path/to/app
   ```

   ```powershell
   # Windows PowerShell
   $prefix = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ([guid]::NewGuid()))
   npx -y --prefix $prefix.FullName mimi-seed@latest check --local --json --path .
   ```

2. Record approximate cold-run and warm-run times. The cold run may download the CLI package; the checker itself
   is bundled and does not launch a second npx install.
3. Compare the finding codes with blockers you already know from Play Console, App Store Connect, or the build.
   `coverage.unresolved` (in the text report: `NEEDS CHECK` items and a summary that says the check is incomplete)
   lists checks Release Doctor could not decide. Report them as unresolved, not as passes.
4. Do not publish the raw JSON. It can contain absolute local paths and app identifiers.
5. Submit only redacted counts, finding codes, framework, and timing through the
   [Release Doctor pilot form](https://github.com/jeonghwanko/mimi-seed-sdk/issues/new?template=release-doctor-pilot.yml).

## What success means

- The correct mobile platform is detected.
- A known Target API or Billing blocker is reported without a false blocker.
- The user gets a useful result without connecting a store account.
- The first result arrives quickly enough that the user does not abandon the command.

The text report follows your system locale (a Korean locale gets Korean, anything else English). Set
`MIMI_SEED_LANG=en` or `MIMI_SEED_LANG=ko` to choose explicitly.

The report is repository-only evidence. It does not guarantee store approval and does not replace connected
metadata, uploaded-build, declaration, or submission-state checks.

## CI trial

Use the blocker exit code only after reviewing the first report. Pin an exact package version when moving from
the pilot to a production branch.

```yaml
- name: Mimi Seed Release Doctor
  # --prefix keeps npx from enforcing the repository's package.json devEngines.
  run: npx -y --prefix "$RUNNER_TEMP/mimi-seed" mimi-seed@latest check --local --fail-on-blocker
```
