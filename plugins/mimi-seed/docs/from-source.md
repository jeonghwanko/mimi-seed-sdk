# Running from source

For when you cloned the repo — to hack on it, or to run code that isn't published yet.

If you just want to *use* Mimi Seed, don't do any of this. Install from npm or the plugin marketplace; the
[README](../README.md) takes about thirty seconds.

---

## 0. What this repo is (read this first)

**This is not an npm workspace.** The two packages install and build **independently** — there is no root
lockfile and no hoisted `node_modules`. The root `package.json` exists only to hold the bootstrap script that
walks both packages for you.

> Don't run `npm install` at the root expecting it to install the packages. Run `npm run setup` (below).

| Package | npm name | What it is |
|---|---|---|
| `packages/cli` | `mimi-seed` | The `mimi-seed` command |
| `packages/mcp-server` | `@yoonion/mimi-seed-mcp` | The local stdio MCP server + the `mimi-seed-*-auth` setup binaries |

---

## 1. Prerequisites

- **Node 20+.** `.nvmrc` is the source of truth — run `nvm use` in the repo root.
- Git.
- A JDK (for `keytool`) **only** if you'll touch Android signing.

---

## 2. Clone and install

One command. It installs + builds both packages, links them globally, and registers the Claude Code MCP plus
the Codex marketplace and plugin. Works verbatim in PowerShell 7 and any POSIX shell:

```bash
git clone https://github.com/jeonghwanko/mimi-seed-sdk.git
cd mimi-seed-sdk
npm run setup
```

Or, from a Claude Code prompt in the checkout, just say **"install it"** — the `mimi-seed-install` skill runs
the same script and walks you through the rest.

Variants:

| Command | Does |
|---|---|
| `npm run setup` | install → build → `npm link` → Claude MCP + Codex plugin registration |
| `npm run setup:codex` | install → build → `npm link` → Codex plugin registration only |
| `npm run install:all` | install → build only (no global link, no MCP registration) |
| `npm run plugin:sync` | refreshes `plugins/mimi-seed` from the root sources of truth |
| `npm test` | checks Codex plugin drift, then runs both package test suites |

Prefer to do it by hand? That's all `scripts/install.mjs` runs:

```bash
cd packages/mcp-server && npm install && npm run build && npm link
cd ../cli              && npm install && npm run build && npm link
```

---

## 3. Run the CLI from your checkout

Two ways. Pick one.

### (a) Throwaway — no build, no global install

From inside `packages/cli`. Note the `--`, which passes the arguments through npm:

```bash
npm run dev -- doctor
npm run dev -- setup
```

This runs the TypeScript directly (via `tsx`), so there's nothing to rebuild. Best for quick iteration.

### (b) Global dev clone — `mimi-seed` on your PATH points at your checkout

This is the **"dev clone"** install shape that the `mimi-seed-update` skill already knows how to detect and
update. Nothing else in the repo told you how to create it:

```bash
cd packages/cli        && npm run build && npm link
cd ../mcp-server       && npm run build && npm link
```

Now `mimi-seed`, `mimi-seed-mcp`, `mimi-seed-auth`, and the rest resolve to your working tree.

Confirm — the arrow is exactly what the update skill greps for:

```bash
npm ls -g --depth=0
#   mimi-seed@x.y.z -> .../mimi-seed-sdk/packages/cli
```

**Link the MCP server too, not just the CLI.** The CLI shells out to the `mimi-seed-*-auth` binaries for every
credential. It prefers a copy already on your `PATH` and only falls back to `npx` (which downloads the
**published** package) when it can't find one. So if you link only `packages/cli`, `mimi-seed setup` will run
the *released* setup binaries, not your checkout. Set `MIMI_SEED_FORCE_NPX=1` if you ever want the published
ones on purpose.

Undo:

```bash
npm unlink -g mimi-seed
npm unlink -g @yoonion/mimi-seed-mcp
```

> ⚠️ **`npm link` links `dist/`, not `src/`.** After every source change, re-run `npm run build` — otherwise the
> linked binary silently keeps running your last build, and you'll debug a version of the code you already
> fixed.

---

## 4. Register your checkout with Claude Code and Codex

Use a **distinct name** (`mimi-seed-dev`) so it can't collide with an installed `mimi-seed`. **Start a new
session afterwards** — the tool list is read at startup.

**If you did the global link (3b)** — no paths involved, so nothing to get wrong:

```bash
claude mcp add mimi-seed-dev -- mimi-seed-mcp
```

**Otherwise**, point at the built entry file with an **absolute** path:

```powershell
# PowerShell, from the repo root
claude mcp add mimi-seed-dev -- node "$PWD\packages\mcp-server\dist\index.js"
```

```bash
# bash / zsh, from the repo root
claude mcp add mimi-seed-dev -- node "$(pwd)/packages/mcp-server/dist/index.js"
```

> `$(pwd)` is not portable — it works in bash, zsh, and PowerShell 7, but **not in `cmd.exe`** (there it's
> `%CD%`). If a linked bare binary name fails to spawn on Windows (npm link installs `.cmd` shims), fall back to
> the absolute `node …\dist\index.js` form above, which always works.

For Codex, install the dedicated marketplace rather than writing only the MCP block. That loads `skills/`
alongside the MCP server. `npm run setup` or `npm run setup:codex` runs these commands for you:

```bash
codex plugin marketplace add .
codex plugin add mimi-seed@yoonion
```

Start a **new thread** after installation. After changing the root plugin sources, run
`npm run plugin:sync`, then use `npm run plugin:check` to catch distribution drift.

---

## 5. First auth from a checkout

```bash
mimi-seed setup          # linked (3b)
npm run dev -- setup     # or, from packages/cli
```

On its first run the wizard asks for your **language** (Korean by default; `[2]` for English), then walks every
credential and tells you where to get each token ([`credentials.md`](credentials.md)).

Change it later with `mimi-seed lang en` / `mimi-seed lang ko`, or force it per-command with
`MIMI_SEED_LANG=en`. The setting lives in `~/.mimi-seed/settings.json` and is passed down to the setup
binaries, so the wizard and its child prompts never end up in different languages.

> ⚠️ **Even from source, Google login is not self-contained.** The OAuth client id/secret is fetched at login
> time from the Mimi Seed web console. If you're offline, air-gapped, or self-hosting, supply your own client:
>
> ```bash
> export MIMI_SEED_GOOGLE_CLIENT_ID=...
> export MIMI_SEED_GOOGLE_CLIENT_SECRET=...
> ```
>
> Create it as a **Desktop app** OAuth client with a loopback redirect on port **9876**.
> → [`troubleshooting.md#config-fetch-failed`](troubleshooting.md#config-fetch-failed)

---

## 6. The change → verify loop

Inside the package you changed:

```bash
npm run build && npm test
```

The CLI additionally needs a real typecheck, because `tsup` does **not** type-check:

```bash
cd packages/cli && npx tsc --noEmit
```

Adding or renaming a tool? The inventory is test-enforced — see the tool-registration checklist in
[`../CONTRIBUTING.md`](../CONTRIBUTING.md) and the ontology in [`domain/_index.md`](domain/_index.md).
