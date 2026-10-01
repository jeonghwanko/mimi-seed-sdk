# Security Policy

Mimi Seed is a local CLI (`mimi-seed`) and a local stdio MCP server (`@yoonion/mimi-seed-mcp`), shipped together
with Claude Code and Codex plugin bundles. They call Google, Apple, Meta, TikTok, GitHub/GitLab, Jenkins, Anthropic,
and Naver (IndexNow) APIs with credentials stored on your machine under `~/.mimi-seed/`.

## Supported versions

Only the **latest release** receives security fixes. Both npm packages and both plugin bundles share one version
number, so "latest" means the newest `mimi-seed` / `@yoonion/mimi-seed-mcp` on npm and the newest
[GitHub release](https://github.com/jeonghwanko/mimi-seed-sdk/releases). Prereleases (`-beta.N`, `-next.N`) are
not supported. If you are on an older version, upgrade before reporting — the issue may already be fixed.

## Reporting a vulnerability

**Please do not open a public issue, pull request, or discussion for a security problem.**

Report it privately by email to the maintainer at the address published in the
[README](https://github.com/jeonghwanko/mimi-seed-sdk#license) and
[CONTRIBUTING](https://github.com/jeonghwanko/mimi-seed-sdk/blob/main/CONTRIBUTING.md#license), with "SECURITY"
in the subject. If the repository's **Security** tab offers **Report a vulnerability**, you can use that private
form instead.

Please include:

- the affected component (CLI command, MCP tool name, skill, or plugin bundle) and version;
- steps to reproduce, and what an attacker gains;
- whether the problem needs a malicious project directory, a malicious MCP client prompt, or network access.

**Never include real credentials** — tokens, `.p8` keys, service-account JSON, keystores, or the contents of
`~/.mimi-seed/`. Use placeholders; if a secret was exposed while you investigated, rotate it first.

## What to expect

This is a small, maintainer-run project, so responses are best effort. We aim to acknowledge a report within a
week, agree on a fix and disclosure timeline with you, ship the fix in a new release, and then publish a GitHub
security advisory that credits you (unless you prefer otherwise).

## Scope

In scope: code in this repository — `packages/cli`, `packages/mcp-server`, `packages/core`, `skills/`, the plugin
manifests, and the CI workflows. Examples of issues we want to hear about:

- a credential under `~/.mimi-seed/` leaking into tool output, logs, telemetry, or an unintended network request;
- a write or destructive MCP tool acting without its preview/`confirm` gate;
- path traversal or command injection through tool parameters, project files, or CLI arguments.

Out of scope: vulnerabilities in the third-party services Mimi Seed calls (report those to the vendor), and
issues that require an attacker who already controls your user account or your `~/.mimi-seed/` directory.

For how credentials are meant to be stored and shared, see
[Teams, security, and automation](docs/user-guide/team-security.md).
