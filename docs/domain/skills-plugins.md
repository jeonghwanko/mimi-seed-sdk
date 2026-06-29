# Skills, plugins & multi-client surface

> How the SDK presents itself to AI clients: skills, plugin manifests, slash commands, and the differences
> between Claude Code, Codex, and Desktop. The runtime "how to call tools" rules live in
> [`../agent-guide.md`](../agent-guide.md); this doc is the *what's installed and where* map.
>
> SSOT: `skills/*/SKILL.md`, `.claude-plugin/`, `.codex-plugin/`, `.mcp.json`, `mcp-server/src/prompts.ts` &
> `resources.ts`.

## Skills (`skills/`)

Four skills, each a `SKILL.md` with YAML frontmatter (`name`, `description`) auto-discovered by the client:

| Skill | Role |
|---|---|
| `mimi-seed` | General entry point. Teaches deferred-tool loading (`ToolSearch select:`) and safety, then **branches** to the domain skills below |
| `playstore-publish` | Play Store listing / track release / image replace / review reply |
| `appstore-publish` | App Store Connect metadata, TestFlight builds, screenshots |
| `deploy` | End-to-end: CI build → readiness check → release notes → store apply |

The `mimi-seed` skill explicitly points deeper work at [`docs/agent-guide.md`](../agent-guide.md). Skill bodies
are written bilingually (Korean prose + English trigger lines); this ontology stays English per repo decision.

## Plugin manifests

| File | For | Notes |
|---|---|---|
| `.claude-plugin/plugin.json` | Claude Code plugin | `name: mimi-seed`, displayName "Mimi Seed"; bundles `skills/` + MCP from `.mcp.json` |
| `.claude-plugin/marketplace.json` | Claude Code marketplace listing | — |
| `.codex-plugin/plugin.json` | Codex plugin | Korean descriptions, default prompts, brand color |
| `.codex-plugin/README.md` | Codex plugin docs | — |
| `.mcp.json` | MCP registration | spawns the **local** server: `npx -y @yoonion/mimi-seed-mcp` |

Keep the version fields in the two `plugin.json` manifests in step with each other when bumping.

## Slash commands & MCP resources

Exposed by the MCP server (`prompts.ts` / `resources.ts`, see [[architecture]]):

- **Prompts → slash commands**: `/mimi-seed:deploy`, `/mimi-seed:health`, `/mimi-seed:review-inbox`.
- **Resources**: `mimi-seed://auth/status` (Google OAuth freshness, JSON) and `mimi-seed://agent/guide` (agent
  role definition, markdown).

These are available in **any** MCP client, independent of the skills (which are a Claude Code / Codex packaging
concept).

## Multi-client differences (matters for how tools appear)

| Client | Tool exposure | Context file it reads |
|---|---|---|
| **Claude Code** | tools are **deferred** — names visible, schemas load on demand via `ToolSearch select:` | `.claude/` (and the root `CLAUDE.md` that imports this ontology) |
| **Codex** | tools typically exposed **directly** | `AGENTS.md` |
| **Claude Desktop** | tools exposed directly | n/a (no project context) |

The deferred-tool behavior in Claude Code is the single biggest source of "this tool doesn't exist" mistakes —
it is the #1 entry in [[pitfalls]] and is documented for agents in [`../agent-guide.md`](../agent-guide.md) §0.

> Note: `mimi-seed init` scaffolds **the user's** project with `.claude/mimi-seed.md` + `AGENTS.md` so both
> clients pick up context there. That is separate from **this repo's** own `CLAUDE.md` / `AGENTS.md`, which
> point contributors at this ontology. Don't confuse the two ([[cli-deploy]]).
