# Teams, Security, and Automation

Mimi Seed can share team state without sharing every credential. Separate Remote workspace state from local
provider credentials and grant only the access each person, CI job, or agent needs.

## What to share and what to keep local

| Item | Recommended location |
|---|---|
| App registration, readiness, team diagnostics | Remote MCP workspace |
| Google OAuth refresh token | Each user's `~/.mimi-seed/tokens.json` |
| App Store API key, Play service account | Local, approved encrypted Remote storage, or CI secret |
| CI PAT, Jenkins token | User home or CI secret store |
| Meta token | The publishing operator's user home |
| Project release context | Repository `AGENTS.md`, `.claude/mimi-seed.md`, `docs/releases.json` |

## Claude Code and Codex

`mimi-seed init` creates context files for both clients in the user's project. Commit them only when team policy
allows, and never put secrets in them.

- Claude Code: tools can be deferred; instruct the agent to select the required tools with ToolSearch first.
- Codex: plugin installation registers the MCP server and skills together.
- Start a new session after installation or update so the running server changes.
- If tools look stale, use the `mimi-seed-update` skill and verify the version actually running.

## Approving agent actions

Store reviews, social comments, Drive documents, and video metadata are text written by other people, and the
agent reads them through Mimi Seed tools. An instruction hidden in that text can try to steer the agent into a
release, an IAM key, or a public post. Keep a person in the loop:

- **Do not auto-approve Mimi Seed's write tools.** Leave them out of the client's allow list, and don't run Mimi
  Seed in a mode that skips permission prompts. Read-only tools are the safe ones to allow.
- **Answer the approval dialog yourself.** When the agent confirms an action that is hard to undo or that
  publishes — or saves a connection setting, uploads a credential to Jenkins, starts a CI workflow, uploads or
  moves Drive files, or registers a Play service account — Mimi Seed
  opens a dialog in the client with the tool and its arguments, and runs only if you tick *approve* and confirm.
  Check the target app, track, version, URL, and text against what you asked for. If the dialog says a value was
  shortened and you can't check the hidden part, decline.
- **Choose the approval mode** with `MIMI_SEED_APPROVAL` in the MCP server's `env`. The default, `auto`, asks
  when the client can show the dialog and otherwise trusts the agent's confirmation. `required` refuses instead,
  which is the team setting to use with a client you have not checked; an unrecognized value also counts as
  `required`. `off` is only for unattended runs, which then have no human check. The `🛡️ Approval:` line of
  `mimi_seed_status` shows which mode is live in your client.
- **Expose only the domains you use** with `MIMI_SEED_TOOLSETS` — a tool that isn't registered can't be misused.

## Codex configuration warning

`mimi-seed mcp codex --write` writes a separate `[mcp_servers.mimi-seed-remote]` HTTP entry. It stores
`bearer_token_env_var = "MIMI_SEED_TOKEN"`, not the PAT itself. Set that environment variable in the process that
launches Codex, restart Codex, and verify with `codex mcp list`. Never put the PAT in a repository
`.codex/config.toml`; remove any legacy inline `http_headers` token if one was committed or copied elsewhere.

## CI automation gates

Recommended order:

```bash
npx mimi-seed setup --non-interactive --fail-on-missing
npx mimi-seed check --app <app-id> --fail-on-blocker
npx mimi-seed deploy --platform android --skip-build --version-code <N> --dry-run
# Run the real deploy only after a separate approval job
```

In CI:

- Inject PATs and service accounts from the secret store
- Do not expose deploy secrets to fork pull requests
- Protect the production environment with approvers and branch rules
- Use `--yes` only after an approval job
- Never print environment variables or config files
- Serialize deploys to prevent track/edit conflicts

## Remote credential synchronization

If the team must share App Store and Play credentials through Remote, use
`mimi_seed_remote_sync_credentials`.

1. Run the default preview and inspect what would be sent
2. Explain encrypted external storage and team scope
3. Obtain explicit approval, then use `confirm=true`
4. Verify the provider-validation result

Google refresh tokens are not synchronized.

## Incident response

1. Revoke the exposed token/key at the provider immediately
2. Replace CI and Remote secrets
3. Reconnect the affected `~/.mimi-seed/` configuration
4. Determine exposure in Git history, build logs, and chat
5. Rewrite history and notify the team when required
6. Review least privilege, expiry, and approval policy

Deleting a file without revoking the credential can leave it valid.

## Example team rules

- Anyone may read and plan; only approvers may release, submit, post publicly, or change IAM
- One store operator per release
- Separate Play Console UI editing time from API operations
- Record dry-run output and final store URLs for every release
- Check expiry regularly with `mimi-seed auth status --all`
