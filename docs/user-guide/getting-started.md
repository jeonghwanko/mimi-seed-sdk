# Getting Started

The goal is to register the current app directory and let Claude Code or Codex understand the app and its
release workflow.

## 1. Choose an install mode

Remote MCP is enough for status and diagnostics. Real writes to stores, Firebase, or social platforms require
Local MCP.

Recommended full setup:

```bash
# Run inside the app project
npx mimi-seed init --local
npx mimi-seed setup
```

`init --local` performs or explains the following:

- Detect app identity from Expo, Gradle, Info.plist, or pbxproj
- Connect a Mimi Seed account in the browser
- Register the app with Remote MCP
- Prepare `.claude/mimi-seed.md`, `AGENTS.md`, and `docs/releases.json`
- Guide Google OAuth and Local MCP registration

Existing project files are not overwritten.

## 2. Install Local MCP in Claude Code or Codex

The plugin is recommended because it includes both the MCP server and workflow skills.

Claude Code:

```text
/plugin marketplace add jeonghwanko/mimi-seed-sdk
/plugin install mimi-seed@yoonion
```

Codex:

```bash
codex plugin marketplace add jeonghwanko/mimi-seed-sdk
codex plugin add mimi-seed@yoonion
```

Start a new session after installing or updating. For manual MCP-only registration, see the root
[README](../../README.md#30-second-start).

## 3. Connect the first accounts

```bash
npx mimi-seed setup
```

The wizard shows current status first and asks only for missing items. You can stop and resume later. Press `?`
on any step to see where to obtain that credential.

You do not need every service on day one. Connect the platforms you use and skip the rest.

## 4. Verify the installation

```bash
npx mimi-seed status
npx mimi-seed auth status --all
npx mimi-seed doctor
```

- `status`: Remote account and registered apps
- `auth status --all`: local credential presence and estimated expiry
- `doctor`: Node, Git, project, token, and CI diagnostics

Ask Claude/Codex:

```text
Check my Mimi Seed connection and give me the exact command for anything missing.
```

For Local MCP, the agent should call `mimi_seed_status` first.

## 5. Run the first safe test

Use reads and a dry run before a real write.

```bash
npx mimi-seed check
npx mimi-seed deploy --platform android --dry-run --skip-build --version-code <current-version-code>
```

`--dry-run` exercises the release pipeline without deploying.

## Next steps

- Missing an account: [Connect accounts](accounts.md)
- Need a CI build: [Build and CI](build-ci.md)
- Already have a build: use the `--skip-build` path in [End-to-end deploy](deploy.md)
- Something failed: [Troubleshooting](../troubleshooting.md)
