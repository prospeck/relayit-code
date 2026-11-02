# Credential storage audit — 2 November 2026

This is a source audit of the RelayIt snapshot, plus isolated tests of the changed paths. It is not a claim that every upstream feature now satisfies RelayIt's secret rules. No installed application data or real keychain entry was inspected. Paths below are relative to the workspace data directory unless marked `userData`, companion, connector, or CLI-owned. Unix permission bits do not supply equivalent Windows ACL guarantees.

## Service-removal scope — 3 November 2026

The upstream Cloud accounts, managed Composio installation, tunnel accounts,
managed companion tunnel, hosted connector deployment and organization handoff
were removed after this audit. Their inventory entries below describe the
2 November snapshot, not available features in this build. Direct Google,
HighLevel private-integration tokens, user-supplied Composio keys, encrypted
configuration, local CLI sign-ins, Tailscale and the person's own HTTPS server
remain. Local transfer to a server of the person's own still carries selected
credentials and is a privileged operation. No installed credentials were read
or migrated during the service removal.

## Shared store design and migration

`electron/credential-store.mjs` implements AES-256-GCM documents in `.credentials/`, with a random 32-byte master key, fresh 12-byte nonces, and authenticated version/namespace separation. Files are atomic, fsynced, owner-only writes; Unix directories are fsynced too. Decryption, authentication and schema failures refuse mutation. Errors never include plaintext, key material or parser input.

Desktop main wraps the master with Electron `safeStorage` in `.credentials/master-key.os`. Electron 43's async decryption result and rewrap flag are handled. Linux `basic_text` is rejected for this store. The embedded utility server requests the unwrapped master over its private Electron `parentPort` after registering its listener, before credential reads. It is never an argument, environment variable, HTTP response or plaintext desktop key file. Other startup messages are buffered until the server attaches its normal listener. The key stays inside trusted application processes, rather than being sent to engine children.

A new headless/server data directory uses `.credentials/master-key` (0600, directory 0700). Settings calls this **Weaker protection: local key file** and explains that possession of the key and ciphertext permits decryption. An existing OS-wrapped store cannot silently downgrade if its keychain becomes unavailable. Promotion keeps the same master and removes the fallback only after a durable wrapped write and verified decryption. Settings describes the **shared credential store**; it does not promise that the remaining upstream stores below are protected.

Google, logins and HighLevel legacy ciphertext is authenticated with its old adjacent key, schema-checked, written to the shared store, read back and checked, then the old ciphertext and key are removed. MCP OAuth does the same with legacy plaintext JSON. Migration resumes after an interruption before cleanup. Per-person MCP files have distinct authenticated namespaces, remain discoverable after restart, and are individually removable.

Configuration secrets become random references in `config.json`, bound to the exact field path in encrypted `config.enc`. Copying a reference into a public profile field is rejected. A save commits the union of old and new values before committing references, so a crash cannot leave a reference without its value. On Unix, the config directory is fsynced before retiring old encrypted values. Windows retains retired encrypted values because this implementation cannot fsync its directory; cleanup there remains a gap. Provider login-folder routing stays metadata so existing backup validation can inspect it without access to the master.

The migrated public settings APIs return configured flags, header/env names or login summaries. Key suffix hints are removed. Known credential values, including rejected config keys and revoked values for this process's lifetime, enter held-value redaction; config error responses pass through redaction too. This does not replace the separate audit of raw console output and subprocess output described below.

Migration is lazy on the first read/save of each store. No compatibility copy is left for older application versions. Downgrading does not make the old version understand the new credential files. Old logs, backups, manually copied files and pre-existing temporary files are not rewritten by this work.

## Persistence and exposure inventory

“Excluded” refers to application workspace backups/restores, not OS backups or arbitrary copies of the disk. Transcript/team/package exports use their own redaction policies; they cannot be assumed to remove an unknown arbitrary secret embedded in user content.

| Writer / location | Credential and protection after this change | Logs / decision log / public responses | Backups, exports, transfer and remaining work |
| --- | --- | --- | --- |
| `server/config.ts`, `server/config-credentials.ts`; `config.json` + `.credentials/config.enc` | Migrated provider API keys, image/live/TTS/decider/helper keys, Boat token, Composio project key, OpenCode provider-key map, instance key fields and credential environment values. AES-GCM; config holds field-bound references. | Held-value redaction; config API configured flags only, no suffixes; rejected-key error replies redacted. Raw subprocess logging remains a separate boundary. | Shared directory excluded; portable backup config omits connection sections; existing privileged Cloud transfer still carries selected credentials. Public provider login-folder metadata remains inspectable by backup checks. |
| Same config writer; `mcpServers` headers/env/`oauth.clientSecret` | Migrated, including values under names that do not look secret. | Public listing returns header/env names and client-secret configured flag. Known values redacted in text/decision rows. | Excluded through config backup allowlist and shared-store exclusion. Explicit Cloud connection handoff still transfers these values. |
| `server/mcp-oauth-store.ts`; root and `people-connections/mcp-oauth/` files | Migrated access/refresh tokens and registration metadata from plaintext into namespace-separated shared documents. | No public token getter; held token redaction. | Root shared directory and all `people-connections/` excluded. Existing privileged connection transfer is retained; not globally write-only. |
| `server/google/store.ts`; legacy `google.json.enc`, `google-key` → `.credentials/google.enc` | Migrated client credentials and OAuth tokens from adjacent-key AES-GCM to shared master. | Status/health are tokenless; client secret and individual OAuth token values held for redaction. | Legacy/new locations excluded. No new export route. |
| `server/login-store.ts`; legacy `logins.json.enc`, `logins-key` → `.credentials/logins.enc` | Migrated passwords, TOTP seeds and 1Password service-account token. | Login summaries expose username/site and `hasTotp`, never password/seed/token. Known values held for redaction. | Excluded. Existing private login/1Password Cloud handoff remains. No downgrade-readable copy. |
| `server/highlevel/store.ts`; legacy `highlevel.json.enc`, `highlevel-key` → `.credentials/highlevel.enc` | Migrated access/refresh/private-integration tokens. | No public token getter; held token redaction. | Excluded; existing connection-transfer workflow remains. |
| `electron/credential-store.mjs`; `.credentials/master-key.os` or `master-key` | New shared master. OS-wrapped on desktop; explicitly weaker owner-only plaintext key fallback on headless/server. | Neither key nor partial key appears in status/errors. Private desktop IPC only. | Entire directory and temporary writes excluded. Losing the only master makes its ciphertext unrecoverable. |
| `electron/main.mjs`, `workspace-credentials.mjs`, secure-credential helpers; `userData/credentials.bin` | Existing separate `safeStorage` document: provider/Boat/Composio keys, managed installation/companion access, phone HPKE private identity and other desktop slots. Not consolidated. | Existing slot-specific IPC/status paths; workspace keys still injected into server environment by existing desktop code. | Outside workspace backups. Existing Linux `basic_text` handling is not consistently rejected on this older path. Existing migration/error handling needs separate hardening; only shared-store references were made safe to skip. |
| `electron/cloud-account.mjs`, `managed-desktop.mjs`; `userData/cloud-account[-staging].bin`, `company-connection.bin`, `company-library.bin` | Existing separate OS-encrypted account/organization/installation tokens. These paths reject Linux `basic_text`. | Public state strips tokens; no new logging verification in this slice. | Outside workspace backup root. Not migrated. |
| `server/team-connections.ts`; `people-connections/apps.json`, `mcp-keys.json` | **Remaining plaintext** personal managed-app installation tokens and personal MCP header values, 0600 in 0700 folder. Personal OAuth tokens are migrated separately above. | Member-scoped connection APIs; arbitrary token/header values are not comprehensively registered with the new scrubber. | Entire directory excluded from workspace backup; not migrated. |
| `server/cloud-connected-apps.ts`; `connected-apps-installation.json` | **Remaining plaintext** managed connected-app installation token, 0600. | Status strips token; existing log handling only. | Explicitly excluded; not migrated. |
| `server/drivers/chatgpt-plan-auth.ts`; provider account `credentials.json` | **Remaining plaintext** ChatGPT access/refresh/ID tokens and registration, owner-only files/directories. | Existing account summaries and sanitized transport errors; no new coverage here. | Managed `providers/` and `engine-homes/` excluded. Configured authentication homes inside portable folders are refused by backup validation. Not migrated. |
| `server/drivers/*`, `engine-homes/sign-ins.ts`, `engine-homes/layout.ts` | External-engine sign-ins and application-made copies: Claude `.credentials.json`, Codex/Grok `auth.json`, Kimi credential JSON, DeepSeek YAML/`.env`, Factory auth/keyring files, Muse/OpenCode/Pi auth JSON, Gemini OAuth JSON, Antigravity `acp_token.json`, plus engine-managed credential files. **Engine-defined protection, often plaintext**; copies use 0600. | Engine native logs/transcripts may contain values; existing redactors do not prove every external CLI's output is safe. | Managed provider/engine homes excluded; external homes are outside workspace archives. External-engine backups/logs are outside this implementation. |
| `server/drivers/claude.ts`, `claude-keepwarm.ts`, `drivers/acp/opencode-go.ts`, other engine adapters | **Remaining plaintext runtime copies**: temporary MCP config/auth settings, compatibility provider `options.apiKey` in generated OpenCode config, engine environment/config. Some writers specify 0600; OpenCode's writer relies on its private runtime location/umask. | Runtime CLIs receive usable credentials; raw child stdout/stderr can bypass structured redaction. | Temporary/runtime/provider locations normally excluded, but arbitrary CLI-selected locations/copies require review. Not migrated; encrypting required CLI input would break the CLI contract. |
| `server/browser-engine.ts`, `browser-sites.ts`, Chrome profile handling | Browser restore cookies/storage encrypted under adjacent `browser-engine-key`; browser profiles/cookies use browser-managed storage; browser-state editing can write plaintext legacy `.json` and temporary files. **Not moved.** | Browser secret holds/scrubbers help screenshots and text; native profile/history/output is not fully covered. | Browser/agent-browser/Chrome profile roots and restore key excluded. External browser/OS backups remain outside this work. |
| `server/webhooks.ts`; `webhooks.json`, `webhook-key` | SHA-256 verifier plus recoverable AES-GCM sealed webhook secret under adjacent key. Provider verification signing secrets share this existing mechanism. **Not moved.** | Ordinary summaries hide secrets, but owner/bot address retrieval intentionally reveals a reusable secret-bearing URL. This violates strict write-only semantics. | Backup strips sealed credential fields and excludes the key; not migrated and owner retrieval behavior retained. |
| `server/sessions.ts`; `sessions.json`; `companion/src/devices.ts`; companion `devices.json` | Session/device bearer **hashes**, not reusable bearer plaintext, in owner-only files. Pairing codes/tickets/replay tokens are memory-only on the server/sidecar. `phones.json` stores registration/identity metadata rather than a bearer. | Public session/device listings strip hashes. Initial pairing necessarily issues a bearer once. | Sessions excluded; companion state lies outside workspace root. Hash storage does not need reversible encryption to validate a bearer. Client-side persistence is separate below. |
| `electron/phone-secret-identity.mjs` and `server/phone-secret.ts` | Phone HPKE private identity remains in desktop `credentials.bin`; private key delivered over desktop IPC, submissions encrypted in transit. | Public key only to phone/sidecar; card/transcript keeps no submitted secret. | Desktop encrypted store outside workspace backups. No real phone/keychain test performed. |
| `server/tunnel.ts`; `tunnel-account.json` | **Remaining plaintext** account/installation/control-plane credentials, 0600, 0700 directory. | Existing public account status strips secrets; no new verification here. | Workspace backup excludes it. Not migrated. |
| `electron/managed-companion-tunnel.mjs`; runtime `connector-*.token` | **Remaining plaintext temporary** tunnel token, private directory and 0600 exclusive file, cleaned by existing lifecycle. | Path rather than token goes to tunnel process; downstream logging still needs auditing. | Outside portable workspace data/runtime excluded. Not migrated. |
| `electron/computer-sharing.mjs`; `userData/computer-sharing.json` | **Remaining plaintext** reusable connector/grant secrets with sharing records, 0600. | Existing desktop-only state/activity boundaries; not newly tested. | Outside workspace backup root. Not migrated. |
| `electron/cua-connection.cjs`; `userData/cua-connection.json` | **Remaining plaintext** local control connection/capability descriptor, 0600 in 0700 user-data directory; usable by local-computer readers. | Runtime-only capability path, not normal credential settings. No new audit of helper output. | Outside workspace backup root. Not migrated. |
| `server/secret-vault.ts`; workspace/VM `.relayit-secrets/<thread>/<card>` | **Remaining deliberate plaintext** custom-secret files for user commands, 0600/0700, 24-hour expiry; one-use refs are memory-only. | Existing held redaction; a user command can read or print a delivered file. | Secret folder excluded from backup/sync/export/upload/checkpoints. File-delivery behavior retained; not compliant with blanket encrypted-at-rest policy. |
| `server/headless/connect.ts`; user-selected `--out` token file | **Remaining plaintext** newly paired bearer, 0600; never terminal output. | CLI prints file path/status, not token. | User-selected location: can enter OS backups or an unrelated project export. Not migrated because external CLI token-file contract remains. |
| `connector/src/state.ts`; connector `agent.json`, `home-env.json` | **Remaining plaintext** connector agent token and cloud-home bootstrap/provider environment, 0600 in private/root-owned volume. | Agent diagnostics/job output and Docker inspection are separate exposure surfaces. | Connector state/disk exports and volume/host backups need their own review. Not migrated. |
| `server/external-runtime.ts`; `external-runtimes.json` | Operator-written bearer registrations; application reads, validates 0600 and hashes in memory. It does not write this credential file. | Not returned by runtime-auth API; code logs only a generic permissions warning. | Explicitly excluded from workspace archives. Operator's source copy remains plaintext and outside migration. |
| `server/harness/http.ts`, `store.ts`, `decision-log.ts`, `admin-activity.ts`, native-log/diagnostic writers, transcript/team/package exporters | Secondary copies rather than intended credential stores. Shared/public redaction masks known values and recognizable shapes; the decision log is redacted before append. **Unknown secret strings, external process output and existing historical records remain risks.** | New tests cover arbitrary migrated values, persisted decision rows, settings errors and isolated fixture logs/API responses. They do not prove every raw `console.*`, stderr, screenshot or user attachment is secret-free. | Portable exports redact text and omit credential values; user content/attachments and earlier archives can already contain secrets. No historical scrub performed. |

## Explicit remaining boundaries

- Credentials in command arguments, URLs, custom unknown config fields, user text/attachments or an external engine's private format are not discovered automatically by the new config-field migration. MCP command args/URLs can still be returned by their existing listing API. Secret headers/env/client secrets are covered.
- Existing Cloud/login/connection handoff is a privileged secret-transfer API, not a strict write-only boundary. It was retained rather than disabling working functionality. Its end-to-end transfer/rollback tests were not run in this slice.
- Existing desktop `credentials.bin` and its environment injection remain; the new master itself never follows that environment path. Separate desktop migration code, including Composio legacy cleanup, still needs a credential-loss audit.
- Per-person personal MCP keys/app installations, ChatGPT-plan sign-ins, browser state, webhooks, tunnel/control grants, connector state, custom secret-file delivery and CLI token files remain outside the shared store.
- Unix config commits retire old encrypted values only after directory fsync. Windows keeps retired encrypted values; there is no secure-erasure guarantee on either platform. Existing OS backups and old plaintext/adjacent-key copies are not erased.
- No cross-process document locking was added. The store keeps the existing synchronous read-modify-write ownership model; concurrent independent writers to the same document need a separate locking/transaction design.
- A currently running application must decrypt credentials to use them. This change protects disk copies and write-only public APIs; it does not claim protection from arbitrary code running as the application or a compromised OS session.
- Remote control-plane/broker databases, cloud-provider managed secrets and arbitrary user/plugin writes are outside this local disk audit. Their persistence and logging need separate review.
- Real Electron/keychain startup, packaging, Windows/Linux runtime behavior, full-suite compatibility and all external CLI output paths remain untested. Electron was not launched.

## Verification and implementation handoff

All tests used disposable data directories/fake credentials. Keychain tests use an in-memory fake; the final HTTP fixture uses a loopback voice-provider fake and repository-owned fake engines. No install, package, Electron launch, push or git configuration change was performed.

Final focused command:

```sh
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run server/credential-storage.e2e.test.ts server/credential-store.test.ts server/config-credentials.test.ts server/login-store.test.ts server/mcp-oauth-store.test.ts server/google/google.test.ts server/highlevel/client.test.ts server/key-hint.test.ts server/workspace-backup-policy.test.ts server/workspace-backup.test.ts server/mcp-oauth.test.ts server/config.test.ts server/routes/team-connections.test.ts server/host/team-connections-host.test.ts electron/workspace-credentials.test.mjs src/components/SettingsModal.connections.test.ts --no-file-parallelism --maxWorkers=1
```

Output:

```text
Test Files  16 passed (16)
Tests       492 passed | 1 skipped (493)
```

The existing skipped backup test requires a case-sensitive temporary filesystem. Node also printed this non-failing warning during Settings rendering:

```text
ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
```

Other final checks:

```sh
NODE_OPTIONS=--max-old-space-size=1500 node --test --test-concurrency=1 electron/credential-store.node-test.mjs
# 11 passed, 0 failed
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run server/credential-store.test.ts --no-file-parallelism --maxWorkers=1
# 3 passed, 0 failed; repeated after adding the outside-workspace private-key refusal assertion
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run server/credential-store.test.ts server/credential-storage.e2e.test.ts --no-file-parallelism --maxWorkers=1
# 4 passed, 0 failed after adding the explicit private-channel request/reply handshake
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run src/components/SettingsModal.connections.test.ts --no-file-parallelism --maxWorkers=1
# 11 passed, 0 failed
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run server/config.test.ts server/config-credentials.test.ts server/credential-store.test.ts server/credential-storage.e2e.test.ts --no-file-parallelism --maxWorkers=1
# 225 passed, 0 failed after adding malformed-config preservation and surrogate-string migration tests
NODE_OPTIONS=--max-old-space-size=3500 npx tsc -p tsconfig.server.json --noEmit
# Exit 0
NODE_OPTIONS=--max-old-space-size=3500 npx tsc -b
# Exit 0
git diff --check
node --check electron/main.mjs
node --check electron/credential-store.mjs
# Exit 0 for each static check
```

Intermediate failures were corrected, rather than counted as passes:

- The initial store run reported `2 failed | 118 passed`: a test still opened `logins.json.enc`, and another expected a stored password to stop being redacted after unregistering its separate scrubber. Updated for shared storage and process-lifetime held redaction.
- The broader run reported `8 failed | 416 passed`: config tests expected plaintext in raw `config.json` rather than decrypted persisted values. The assertions now hydrate storage; separate tests assert raw disk confidentiality.
- The first HTTP test failed with `expected 400 to be 200`; its response was `ElevenLabs rejected that key. If it's a restricted key, give it the Voices and Text to Speech permissions — or paste an unrestricted one.` The test initially exercised the existing external provider validator with a synthetic key. The final test replaces that dependency with an owned loopback fake, and also tests a fake provider echoing a rejected key.
- The first expanded Settings run reported `1 failed | 491 passed | 1 skipped`, with `TypeError: Cannot read properties of undefined (reading 'origin')`. The general Settings fixture needed `window.location`; adding the mock made its 11 tests pass, followed by the final 16-file passing run above.
- Initial server type checks failed on new test/body types, the saved-login empty-record type, an unused import, a config-root cast and the test's invalid decision kind (`"allow"` is not `DecisionKind`). A later app check caught missing required config-frame fields in the new Settings test (`vps, box, composio, rooms, localVm`). These were corrected; final server and app type checks exited 0. No memory abort was treated as a pass.

The final configuration hardening also refuses to overwrite malformed/unreadable config on a later settings save, and accepts JSON strings with unpaired surrogates in held-value redaction. Both have focused preservation/migration tests in the 225-test recheck above.

Changed production files, grouped by purpose:

- `electron/credential-store.mjs`, its `.d.mts`, `server/credential-store.ts`: cryptography, master lifecycle, private IPC reception, safe legacy-document migration and held-value redaction. `electron/main.mjs` sends the private master and avoids re-migrating a Composio reference.
- `server/google/store.ts`, `server/login-store.ts`, `server/highlevel/store.ts`, `server/mcp-oauth-store.ts`: priority store migrations. `server/team-connections.ts` discovers/removes encrypted per-person OAuth documents without merging members' accounts.
- `server/config-credentials.ts`, `server/config.ts`: field-bound config references and staged encrypted commits. `server/routes/config.ts` redacts settings/error responses, and `server/key-hint.ts` removes credential suffix disclosure. `electron/workspace-credentials.mjs` leaves encrypted references alone.
- `server/provider-auth-paths.ts`, `server/workspace-backup.ts`, `server/workspace-backup-policy.ts`: preserve backup validation of provider auth homes and exclude shared secret/master/temp files.
- `server/index.ts`, `src/state/config-status.ts`, `src/state/store.tsx`, `src/components/SettingsModal.tsx`: report and preserve storage protection status, shown in both Settings layouts.
- `server/cli-setup.ts`, `README.md`, this report: correct storage descriptions and record the audit/gaps. Corresponding focused tests were added or updated; LICENSE, NOTICE and `third_party/` remain untouched.
