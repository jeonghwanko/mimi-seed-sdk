# Design: encrypt `~/.mimi-seed/` credentials at rest with an OS-held key

> **Status: stage 2 in progress.**
> - Stage 1 is done. Every credential loader reads through core and understands envelopes
>   (`core/src/credential-{envelope,keystore,read}.ts`; `credential-reader-guard.test.ts` keeps it that way).
>   Diagnostics report `locked`.
> - In stage 2 so far, writers encrypt only when `MIMI_SEED_CREDENTIAL_STORE` (or `settings.json`
>   `credentialStore`) is `keychain` or `auto` (`core/src/credential-store.ts`). The default stays `file`, which is
>   plaintext `0600` ([`../domain/auth-credentials.md`](../domain/auth-credentials.md)).
> - `mimi-seed credentials status|mode|encrypt|decrypt` (`cli/src/credentials-cmd.ts`) and the `doctor` /
>   `mimi_seed_status` storage lines are in place. The user docs are in [`../credentials.md`](../credentials.md#encrypt-stored-credentials).
> - The version-skew check refuses to turn encryption on while an MCP registration in `~/.claude.json`,
>   `~/.codex/config.toml`, `~/.cursor/mcp.json`, or `./.mcp.json` is pinned to a release from before encrypted
>   credentials could be read (`FIRST_ENVELOPE_READER` in `credentials-cmd.ts`). A range pin is judged by the newest
>   version it resolves to. `@latest` registrations, the default, pass. An MCP server installed globally without a
>   version in its registration can't be checked this way.
> - Next is stage 3: deciding whether `auto` becomes the default (§9 Q1).
> This document describes structure only and contains no secret values.

## 1. Problem

Every credential the SDK keeps is a plaintext file under `~/.mimi-seed/`: the Google OAuth refresh token, the
App Store Connect `.p8` key, Play / BigQuery / Drive service-account keys, social tokens, CI and Jenkins tokens,
and the web PAT. File mode `0600` keeps them away from **other local users**. It does nothing about **copies of
the home directory**:

- backups (Time Machine, restic, a `tar ~` before reinstalling);
- cloud-synced or dotfile-managed home folders;
- disk images, support bundles, and old laptops;
- a mistaken `cp -r ~/.mimi-seed` into a repository or a chat.

One leaked `tokens.json` is a long-lived Google refresh token. One leaked service-account key is valid until it
is revoked. These are the highest-value files on a release engineer's machine.

## 2. Goals and non-goals

**Goals**

- A copy of `~/.mimi-seed/` taken off the machine does not reveal any credential. That includes a copy of
  the **whole home directory**, unless the attacker also has the user's OS login password (see "What the key
  store really protects" below).
- No behavior change for users who do not opt in, and no new npm dependency (`packages/core` stays
  `node:`-only, enforced by `core-boundary.test.ts`).
- Keep the guarantees we already have: one writer per credential file, atomic `0600` writes
  (`core/src/atomic-write.ts`), and readers that distinguish *missing* from *unreadable*
  (`core/src/json-file.ts`, PR #116 and #118).
- Work everywhere the SDK runs today. Where no OS key store exists (CI, containers, headless Linux, SSH
  sessions), fall back to today's plaintext files and say so in `doctor` / `mimi_seed_status`.

**Non-goals**

- **Malware running as the user.** It can ask the OS key store for the same key the SDK asks for, or read the
  process memory. No design that lets an unattended MCP server read its own credentials stops this. We say so
  in the docs instead of implying more protection than we give.
- Root or administrator access, and a compromised OS.
- Credentials passed as **environment variables** (`MIMI_SEED_DRIVE_SA_JSON`, `MIMI_SEED_TOKEN`,
  `ANTHROPIC_API_KEY`, …). They are outside `~/.mimi-seed/` and stay unchanged.
- Files the user takes **out** of the SDK on purpose, covered in §6 "Out of scope".
- **Write access to `~/.mimi-seed/`.** Someone who can write there can swap a credential for their own, for
  example by replacing an encrypted file with a plaintext one, which readers still accept (§4.1). They can
  also edit the user's MCP client config and run code. Encryption at rest does not try to stop this.

**What the key store really protects.** Each OS key store is itself a file in the home directory, encrypted
with a secret derived from the login password:

- on macOS, the login keychain under `~/Library/Keychains/`;
- on Windows, the DPAPI master keys under `%APPDATA%\Microsoft\Protect\`;
- on Linux, GNOME Keyring under `~/.local/share/keyrings/`.

So a copy of `~/.mimi-seed/` **alone** reveals nothing. A full home-directory copy reveals the credentials
only to someone who also knows or can crack the login password. This is the same bar as the browser's saved
passwords. The user-facing docs must say it that way and not claim more.

## 3. Options considered

| | A. One OS key-store item per secret | **B. Encrypted files, one OS-held data key (proposed)** | C. Passphrase-derived key |
|---|---|---|---|
| Where secrets live | OS key store | `~/.mimi-seed/*.json`, encrypted | `~/.mimi-seed/*.json`, encrypted |
| What the OS key store holds | every secret | one random 256-bit key | nothing |
| Unattended MCP server | ✅ | ✅ | ❌ needs a prompt or an env var that is itself a plaintext secret |
| Windows size limit (Credential Manager blob ≤ 2,560 bytes) | ❌ an SA key is close to it; a social profile file bundles three tokens | ✅ 32 bytes | — |
| Atomic writes / one writer per file | ❌ lost, the store has no rename | ✅ unchanged; the writer encrypts before the same atomic rename | ✅ |
| Listing (`play-service-accounts/`, the `mimi_seed_status` scan, `doctor`) | ❌ needs key-store enumeration, which the CLIs don't offer cleanly | ✅ still a directory listing | ✅ |
| Process spawns per run | one per secret read | **one per process** (the key is cached in memory) | none |
| Migration | rewrite every reader against a new API | readers gain one decode step; plaintext stays readable | same as B |

**B is proposed.** It keeps the file layout and every existing code path, and it touches the OS key store once
per process for 32 bytes. Option A would break the atomic-write and one-writer guarantees and hit the Windows
size limit. Option C cannot run unattended, which is how the MCP server runs.

## 4. Design

### 4.1 Envelope format

An encrypted credential is still a JSON file at the same path, so tri-state readers parse it as before:

```json
{
  "mimiSeedEncrypted": 1,
  "alg": "A256GCM",
  "kid": "<first 8 bytes of SHA-256(data key), hex>",
  "iv": "<12 random bytes, base64>",
  "tag": "<16 bytes, base64>",
  "data": "<ciphertext, base64>"
}
```

- **AES-256-GCM** from `node:crypto`. A fresh random IV is used for every write.
- **The AAD is the path relative to `~/.mimi-seed/`** (for example `play-service-accounts/com.example.app.json`).
  A file copied over another one fails authentication instead of quietly giving package B the service
  account of package A. That is the same class of bug the per-package path check guards against
  ([`../domain/pitfalls.md`](../domain/pitfalls.md) §20).
- **`kid`** lets a reader tell "this file was encrypted with a key that is not in this machine's key store" (a
  home directory restored on a new machine) apart from "this file is corrupt". Both are reported. Neither is
  reported as "not configured".
- Plaintext stays a valid format forever, so a reader accepts both. `mimiSeedEncrypted` is the only marker.
  No credential format the SDK writes has that key today.
- A random 96-bit IV per write is safe far beyond the number of writes one key will ever see. A token refresh
  is the most frequent writer, at most a few per hour per grant.
- **AAD is relative to the credential root the file was read from.** The legacy `~/.preseed/` fallback
  (`appstore.json`, `tokens.json`) is read-only. Nothing is ever written or encrypted there, so its files stay
  plaintext and keep being accepted. A rule for future code: a migration that moves a credential to a new
  path must decrypt and re-write it through the writer. Copying the bytes would fail the AAD check. No code
  moves or copies credential files today.

### 4.2 Where the data key lives

| OS | Backend | How we reach it (no npm dependency) |
|---|---|---|
| macOS | login keychain, generic password item `service = mimi-seed`, `account = data-key` | `/usr/bin/security`. Writes go through `security -i` on **stdin**, never `-w <secret>` in argv, where `ps` would show it. Reads use `find-generic-password -w`. The item's ACL then trusts `/usr/bin/security` itself, so a Node upgrade (a new `node` path under nvm or Homebrew) does not trigger a keychain prompt. |
| Windows | DPAPI (`CurrentUser`) protecting the data key, stored as `~/.mimi-seed/.data-key.dpapi` | `powershell.exe` with `[System.Security.Cryptography.ProtectedData]` (Windows PowerShell 5.1, present on every supported Windows). Input and output go over stdin and stdout. DPAPI is chosen over Credential Manager because Credential Manager has no built-in CLI that can **read** a secret. |
| Linux | Secret Service (GNOME Keyring, KWallet) | `secret-tool store` (the secret goes on stdin) and `secret-tool lookup`. This needs `libsecret-tools` and a D-Bus session. If either is missing, the backend is *unavailable* and we fall back. |
| Any | none | Plaintext files, as today. |

The backend is behind one small interface in core (`get(): Buffer | null`, `createExclusive(key): Buffer`)
with a fake used in tests. All process calls are `spawnSync`, so the many **synchronous** readers in
mcp-server (for example `getServiceAccountJson`) keep their signatures.

The child's stdin, stdout, and stderr are always **pipes**, never `inherit`. The MCP server's stdout is the
stdio protocol channel. A key printed there, or a keychain prompt written there, would corrupt the session
and leak the key into the client's log. The key's base64 text is decoded and the buffers are zeroed after use. The first call costs tens of
milliseconds on macOS and Linux, and up to about a second for PowerShell's cold start on Windows. After that
the key is cached for the life of the process.

### 4.3 Creating the key without a race

Several processes start at the same moment (an MCP server per client, plus the CLI). If two of them generate a
key and both store it, files encrypted with the losing key become unreadable. Creation therefore always ends
with "**create exclusively, then re-read the winner**":

- On macOS, `add-generic-password` **without** `-U` fails with a duplicate-item status if the item exists.
  The loser reads the existing item.
- On Windows, the `.dpapi` file is published with `link(2)`, which fails on `EEXIST`. This is the same
  exclusive-publish pattern `jenkins/builds.ts` uses for its receipts.
- `secret-tool store` overwrites, so creation on Linux runs under a `mkdir` lock (`~/.mimi-seed/.data-key.lock`),
  re-checks after taking the lock, and removes a stale lock after a timeout.

A key is only ever **created** on a write. A read with no key never creates one.

Once a key exists, its `kid` is recorded in `~/.mimi-seed/.data-key.id`. The `kid` is not secret: it is a
hash prefix and decrypts nothing. That file is the memory that this machine encrypts. Without it, `auto`
mode (§4.5) could not tell "no key store here" from "the key store is temporarily unreachable". It would then
write a plaintext `tokens.json` next to encrypted siblings during an SSH session, while the login keychain is
locked.

### 4.4 Read and write paths

**Write.** `writeCredentialJson` / `writeCredentialFile` (`core/src/atomic-write.ts`) are already the only
writers (`atomic-write.test.ts` keeps the list complete). In `keychain` mode they encrypt, then run the same
temp-file → `chmod 0600` → `rename` sequence. No writer module changes.

**Read.** Credential readers are spread across a few dozen modules in both packages, most of them using
`fs.readFileSync` with `JSON.parse`. They move to one core function, `readCredentialText(path)` (and the
credential-aware form of `readJsonFile`). It returns the plaintext for either format. A new guard test,
mirroring the writer guard, rejects a raw `readFileSync` of a `~/.mimi-seed` credential path outside core.

Three surfaces only **scan** files and do not use them. They must switch too, because an envelope is valid
JSON:

- `findInvalidJsonFiles`, behind the `mimi_seed_status` damaged-file list;
- the CLI's `detectAll` / `credentialFileProblemMessage` (#118);
- `listRegisteredServiceAccounts`.

If they stayed on raw parsing, a `locked` file would look healthy, or every encrypted file would look like a
service account with no email.

`readJsonFile` gains one state:

| State | Meaning | Shown as |
|---|---|---|
| `missing` | no file | "not configured" (unchanged) |
| `ok` | plaintext or decrypted | — |
| `invalid` | corrupt JSON / failed GCM tag / wrong AAD | "file is damaged …" (#118 wording) |
| **`locked`** | encrypted, but the key named by `kid` is not available (no key store, a different machine, the item was deleted) | "encrypted with a key this machine does not have — sign in again: `<fix>`" |

As today, error text carries only a location or a state and never ciphertext, plaintext, or the key.

### 4.5 Modes

`MIMI_SEED_CREDENTIAL_STORE` = `file` | `keychain` | `auto`, also settable with `mimi-seed credentials mode <m>`
and stored in `settings.json` next to `lang`.

- `file` writes plaintext, as today. Reads accept both formats.
- `keychain` encrypts every write. If the backend is unavailable, the **write fails** with the reason. It does
  not fall back to plaintext without telling you.
- `auto` encrypts when a backend is available, and otherwise writes plaintext. `doctor` reports which one
  happened. **Once `.data-key.id` exists, `auto` behaves like `keychain`.** It never downgrades a machine
  that already encrypts, so a locked keychain over SSH makes the write fail with "unlock the keychain"
  instead of leaving a plaintext token beside encrypted ones.
- The same rule covers a **missing** mode. If `settings.json` is deleted or corrupted and its `credentialStore`
  goes with it, a machine with `.data-key.id` keeps encrypting. Only an explicit `file`, from the environment
  variable or `mimi-seed credentials mode file`, returns to plaintext. (`core/src/credential-store.ts`
  `effectiveStoreMode`.)

`doctor` and `mimi_seed_status` gain one line: the storage mode, the backend found, and how many files are
still plaintext.

## 5. Rollout

Two SDK versions can run side by side: the Claude Code plugin pins one, a global `mimi-seed` install can be
older, and `npx -y` fetches the latest. An **older reader that meets an encrypted file** sees JSON without the
fields it expects. So **readers ship one release before any writer encrypts**.

| Stage | Ships | Default | User-visible |
|---|---|---|---|
| 1 | envelope + backends + `readCredentialText` in core; every reader migrated; the reader guard; the `locked` state | `file` | nothing (reads accept both formats) |
| 2 | `keychain` / `auto` modes; `mimi-seed credentials encrypt` / `decrypt` / `status`; `doctor` and `mimi_seed_status` lines; docs and troubleshooting entries | `file` (opt-in) | an opt-in |
| 3 | after stage 2 has been out for at least one release with no `locked` / `invalid` regressions | `auto` on macOS and Windows; Linux stays opt-in until Secret Service detection is proven on headless boxes | new writes are encrypted |

Opting in at stage 2 is still unsafe if an install that predates stage 1 reads the same `~/.mimi-seed/`.
The opt-in command therefore checks the versions it can see (the global CLI, and the MCP server version that
`mimi-seed doctor` already reports). It refuses while one predates stage 1, and it names that install.

The `.data-key.*` files are never touched by `credentials encrypt` / `decrypt`, and never synced or uploaded.

Existing plaintext files are not rewritten in the background. They are encrypted on their next normal write
(for `tokens.json`, the next access-token refresh) or all at once with `mimi-seed credentials encrypt`.
`mimi-seed credentials decrypt` reverses it before a downgrade or a move to a machine without a key store.

`credentials encrypt` and `decrypt` cover the encryptable files under `~/.mimi-seed/` that are listed in §6 (scope).
Each file is rewritten through the atomic writer, so a crash in the middle leaves every file either old or new.

## 6. Scope

**In scope (encrypted).** `tokens.json`, `credentials.json`, `google-profiles/*.json`, `appstore.json`,
`play-service-account.json`, `play-service-accounts/*.json`, `bigquery-service-account.json`,
`drive-service-account.json`, `facebook.json`, `instagram.json`, `threads.json`, `social-profiles/*.json`,
`tiktok-business.json`, `google-ads.json`, `jenkins.json`, `ci.json`, `config.json`.

**Out of scope (stay plaintext).**

- `keys/*.json`. `iam_create_key` hands back a path so the user can use the key outside the SDK (gcloud, a CI
  secret). The SDK's own readers (`playstore_register_service_account`, `jenkins_upload_playstore_sa`) accept
  either format, so this can change later.
- `keystores/*/upload.jks` and `signing.json`. The user's Gradle build and CI read these directly.
- `settings.json`, `telemetry.json`, and `jenkins-build-requests/`. They hold no secret, or only an HMAC
  fingerprint plus its per-install key, which grants nothing outside the SDK.

## 7. Failure handling (fail closed, say why)

| Situation | Behavior |
|---|---|
| Encrypted file, key store has no key | `locked`; the tool or `doctor` names the file and the re-login command. We never fall back to another credential (the rule from #116). |
| Key-store call fails (keychain locked over SSH, D-Bus gone, PowerShell in Constrained Language Mode under AppLocker/WDAC, which blocks the .NET call) | `locked`, with the backend's exit status. Never `missing`. A command line from `-Command` is not subject to execution policy, but language mode still applies. |
| The login keychain was replaced (an administrator reset the macOS password, so the old keychain is set aside) | every encrypted file is `locked`. Recovery is signing in to each service again. `credentials status` lists them. This is the real cost of the design, and the user docs state it. |
| GCM tag or AAD mismatch | `invalid` ("file is damaged"), the same as corrupt JSON |
| `keychain` mode and the backend is unavailable when writing | the write throws the reason; the old file is untouched |
| User deletes the keychain item | the files are unrecoverable by design; recovery is signing in again. `credentials status` shows the `kid` it expects. |

## 8. Testing

- Unit tests in core use the fake backend: round trip, AAD swap rejected, wrong `kid` gives `locked`,
  plaintext still read, and a concurrent create converges on one key (two workers racing on `createExclusive`).
- Backend tests run in CI on the OS they target:
  - macOS: a throwaway keychain (`security create-keychain`), never the login keychain.
  - Windows: real DPAPI on the runner.
  - Linux: skipped unless `secret-tool` and a D-Bus session exist.
- Guards:
  - the reader guard (no raw credential read outside core);
  - a stdout guard: the backend never spawns with `stdio: 'inherit'`;
  - the existing writer guard;
  - a test that no envelope field, error message, or log line ever contains plaintext or key bytes, using a
    marker value like the #118 leak test.

## 9. Open questions for review

1. Should the stage 3 default be `auto` on macOS and Windows, or stay opt-in everywhere until a user asks?
2. Should `signing.json` (keystore passwords) be in scope, with a `credentials export` command for CI, or stay
   plaintext because CI reads it?
3. Is DPAPI with a key file acceptable on Windows, or is a Credential Manager entry required (and if so,
   through which reader, since no built-in CLI returns the secret)?
4. Command naming: `mimi-seed credentials encrypt|decrypt|status|mode`, or under `mimi-seed doctor --fix`?
5. In `keychain` mode, should readers **refuse** a plaintext file once `.data-key.id` exists, so a swapped-in
   plaintext credential is rejected? That breaks hand-placed files and the legacy `~/.preseed/` fallback, so the
   proposal currently accepts it and only flags it in `credentials status`.
