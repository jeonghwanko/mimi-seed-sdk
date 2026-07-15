# Build and CI

Mimi Seed is not an app compiler. It triggers and monitors an existing GitHub Actions, GitLab CI, or Jenkins
job. The CI workflow owns signing, dependency installation, tests, `.aab`/`.ipa` creation, and artifact upload.

## Supported paths

| CI | What Mimi Seed does | Version handling |
|---|---|---|
| GitHub Actions | Trigger workflow_dispatch and monitor the run | Run ID is not a versionCode; pass one explicitly |
| GitLab CI | Trigger and monitor a pipeline | Pipeline ID is not a versionCode; pass one explicitly |
| Jenkins | Trigger a parameterized build and follow queue/build state | A successful build number can be used as versionCode |

## 1. Make CI work on its own first

The provider's manual Run button must succeed before adding Mimi Seed.

- Android: build a release variant, sign it, produce an AAB, optionally upload it to Play
- iOS: archive/export, provision and sign, produce an IPA or upload to App Store Connect
- Exit non-zero on failure
- Print the final versionCode/build number where an operator can find it
- Inject secrets from the CI secret store

Mimi Seed does not repair a broken build script or bypass it with a local compilation.

## 2. Connect CI

GitHub Actions:

```bash
npx mimi-seed deploy setup-github
```

GitLab:

```bash
npx mimi-seed deploy setup-gitlab
```

Jenkins:

```bash
npx mimi-seed deploy setup-jenkins
```

A GitHub PAT needs access to the target repository and its workflows. A GitLab PAT needs the `api` scope.
Jenkins validates the URL, user, API token, and Android/iOS job names before saving.

## 3. Dry-run with a build

GitHub Actions example:

```bash
npx mimi-seed deploy \
  --platform android \
  --ci github \
  --workflow deploy.yml \
  --ref main \
  --version-code 142 \
  --dry-run
```

Use `--ci gitlab --ref main` for GitLab or `--ci jenkins` for Jenkins. `mimi-seed deploy --help` is the source
of truth for current flags.

> A GitHub run ID or GitLab pipeline ID is not an Android versionCode. Decide the versionCode in the workflow
> and pass it as `--version-code <N>`. A Jenkins build number can work, but it must still exceed the app's
> previous version.

## 4. If the build already exists

Do not trigger CI again.

```bash
npx mimi-seed deploy \
  --platform android \
  --skip-build \
  --version-code 142 \
  --dry-run
```

Use this path when the build is already uploaded to a store or was produced by a separate CI process.

## Claude/Codex prompt examples

```text
Inspect the configured CI and recent builds. Do not write anything; give me the failure cause and next command.
```

```text
Trigger GitHub Actions deploy.yml on main and monitor it. Do not release to a store.
```

The MCP surface exposes `ci_*` tools for GitHub/GitLab builds. Jenkins MCP tools manage credentials and job
configuration; the CLI `deploy` flow triggers and monitors Jenkins builds.

## Failure recovery

- Workflow not found: use the exact filename under `.github/workflows/`
- 401/403: check PAT scopes, owner/namespace, and Enterprise host
- Build succeeded but versionCode is unknown: find it in CI output, then continue with `--skip-build --version-code <N>`
- Jenkins queue stalls: check executors and job permissions
- 30-minute timeout: inspect the provider; if the build completed, continue with `--skip-build`

Continue with [Release readiness](release-readiness.md) and [End-to-end deploy](deploy.md).
