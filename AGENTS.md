# Mimi Seed SDK

This repository is the public developer-tooling source of truth for Mimi Seed.

## Ownership

- `packages/cli`: `mimi-seed` npm CLI.
- `packages/mcp-server`: `@yoonion/mimi-seed-mcp` local stdio MCP server.
- `.codex-plugin`, `.mcp.json`, `skills`: Codex plugin and skill surface.
- Root README files: public installation docs mirrored by the private web console repo.

The private web console lives in a separate repo (not this SDK). Do not move SDK package implementation back into that repo.

## Codex Support

- `mimi-seed init` should generate both Claude Code context (`.claude/mimi-seed.md`) and Codex context (`AGENTS.md`) in user projects.
- `mimi-seed mcp codex --write` should write the remote HTTP MCP block to `~/.codex/config.toml`.
- The local MCP server can also be registered in Codex with:

```toml
[mcp_servers.mimi-seed]
command = "npx"
args = ["-y", "@yoonion/mimi-seed-mcp"]
enabled = true
```

- User-facing docs should present Claude Code and Codex together when the workflow applies to both.

## Verification

For CLI changes:

```bash
npm run build
npm test
```

Run those inside `packages/cli`. For MCP server changes, run the same commands inside `packages/mcp-server`.

Do not overwrite unrelated local changes; this repo is often used to stage package work separately from web-console docs.
