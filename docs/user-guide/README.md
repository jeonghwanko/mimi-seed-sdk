# Mimi Seed User Guide

This is the task-oriented guide for people who **install Mimi Seed**, **ship an app**, and **operate it after
launch**. Start with the outcome you want instead of memorizing tool names.

> The most important boundary: Mimi Seed does not compile `.aab` or `.ipa` files locally. It triggers and
> monitors an existing GitHub Actions, GitLab CI, or Jenkins build, then connects readiness checks, release
> notes, and store operations into one release flow.

## If this is your first time

1. [Getting started](getting-started.md) — choose an install mode, register a project, check status
2. [Connect accounts](accounts.md) — Google, Apple, Play, CI, and Meta credentials and recovery
3. [Build and CI](build-ci.md) — connect GitHub Actions, GitLab, or Jenkins
4. [Release readiness](release-readiness.md) — find blockers before a real release
5. [End-to-end deploy](deploy.md) — go from build to store application

## Find a guide by outcome

| I want to… | Guide |
|---|---|
| Add Mimi Seed to an existing app | [Getting started](getting-started.md) |
| Connect the required accounts and tokens | [Connect accounts](accounts.md) |
| Trigger and monitor a CI build | [Build and CI](build-ci.md) |
| Check for launch blockers | [Release readiness](release-readiness.md) |
| Deploy Android or iOS end to end | [End-to-end deploy](deploy.md) |
| Operate Play Store or App Store directly | [Store operations](stores.md) |
| Operate Firebase, AdMob, GA4, or BigQuery | [Cloud and analytics](cloud-operations.md) |
| Post to Facebook, Instagram, or Threads | [Social publishing](social.md) |
| Use Claude Code, Codex, and team automation safely | [Teams, security, and automation](team-security.md) |

## Three surfaces

| Surface | Best for | Limitation |
|---|---|---|
| Remote MCP | App inventory, readiness, blockers, shared diagnostics | Most store and cloud writes require Local MCP |
| Local MCP | Play/App Store, Firebase, AdMob, IAM, analytics, social posting | Requires local credentials and Node 20+ |
| `mimi-seed` CLI | Init, guided account setup, CI builds, readiness, full deploy | Some detailed work is exposed as MCP tools in Claude/Codex |

Remote and Local are complementary. A complete setup commonly uses Remote for team/project state and Local for
direct provider API writes.

## Safety rules for every workflow

- Start with reads and previews; inspect the result before a write.
- Reconfirm the target and scope before production release, review submission, public posting, or IAM changes.
- Never paste tokens, `.p8` files, or service-account JSON into a repository, chat, issue, or log.
- Do not mix unpublished Play Console edits with Play API writes.
- In automation, gate work with `mimi-seed setup --non-interactive --fail-on-missing`.

## Reference material

- How to obtain each credential: [Credential reference](../credentials.md)
- Error codes and recovery: [Troubleshooting](../troubleshooting.md)
- Development from a checkout: [Run from source](../from-source.md)
- Runtime rules for AI agents: [Agent guide](../agent-guide.md)
- Complete tool classification: [Tool catalog](../domain/tool-catalog.md)
