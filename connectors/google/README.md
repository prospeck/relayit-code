Direct Google REST connector ported from RelayIt's `connectors/google` (including
the machine-readable access checks in commit `2bd2bb1`). No Composio dependency.
The local tool contract replaces the original monorepo's `@relayit/shared` import.

The application owns credentials and exposes the optional built-in `google` MCP
server through its turn-scoped stdio harness proxy. Settings → Connections offers
OAuth setup and a synthetic demo inbox. Both Gmail and Calendar must pass their
access probes before Settings says Connected.

Focused tests, from the repository root:

```
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run connectors/google/tests/ --no-file-parallelism --maxWorkers=1
```

Storage and transport:

- `server/google/store.ts` uses the app's existing AES-256-GCM storage format,
  also used for saved logins and HighLevel. `google.json.enc` contains the OAuth
  client ID, secret, tokens and selected mode. Its private key is `google-key`
  beside the ciphertext, with 0600 permissions. This is local file encryption,
  **not OS-keychain-backed storage**; someone who can read both files can decrypt
  it. Neither file is included in workspace exports or restores.
- `/api/google` exposes status only; credentials can only be written through
  the owner/admin connection route. The stdio child gets a turn-scoped bearer
  for the app's loopback harness, never Google credentials in argv, environment
  or MCP results.
- Google uses the built-in harness MCP proxy rather than registering a user
  command or using generic MCP OAuth. This keeps refresh tokens in one process,
  uses native approval cards, and avoids the generic OAuth store's plaintext
  token JSON. It also works in the bundled server without new entry points or
  dependencies.
- The Full-access mount goes through `mcp-gate` with `refuseOutbound`, and the
  server independently checks the live approval level before execution. Sends
  and Calendar create/update/cancel always ask; the bot's daily allowance cannot
  bypass this. Reads and drafts do not show the connector's approval card.
- Mail, Calendar and draft results use the app's sanitized records wrapper.
  Read-and-draft routines can only read these services or draft a non-reply-all
  answer in a thread their check approved.
- Proactive reads implement the native `ConnectedReads` interface directly.
  Inbox classification uses the ported local heuristic, including demo mode;
  it never invokes upstream's extractor/decider relay. Existing brief cards and
  "Keep an eye on my day" routines consume those reads. Calendar reads currently
  cover the primary calendar, as in the original direct connector.

Settings rechecks both APIs after sign-in and while open: every ten seconds for
an access issue and every minute after success. Missing scopes, disabled APIs
and expired sign-ins keep Connected false. Console fixes use only Google reason
codes and numeric `metadata.consumer` project numbers, never provider prose or
provider-supplied activation URLs. The loopback success page says sign-in was
received; the application decides whether the connection works.

The demo runs an in-process HTTP server on 127.0.0.1 with an invented mailbox and
calendar. It resets its invented contents when the application restarts. No
Google account, upstream service or broker is involved.

Verification uses fake Google and the app's isolated verification launcher.
No real Google account or Electron desktop was used. Other engine adapters mount
this built-in, but the full app workflow is exercised with the fake Claude CLI;
provider-specific extra permission prompts are not qualified for every ACP engine.

Validation and review scope:

The focused run passed **228 tests in 15 files**:

```sh
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run connectors/google/tests/ server/google/google.test.ts server/google.e2e.test.ts src/components/GoogleConnectionSettings.test.ts shared/outbound.test.ts server/mcp-gate.test.ts server/read-and-draft.test.ts server/harness-mcp-proxy.test.ts server/workspace-backup-policy.test.ts server/host/proactive.test.ts server/host/brief.test.ts server/host/inbox-triage.test.ts server/drivers/turn-mcp.test.ts src/components/SettingsModal.connections.test.ts --no-file-parallelism --maxWorkers=1
```

This covers the fake Google REST APIs, PKCE/state/cancellation/token refresh,
service sign-in and access recovery, encryption and export exclusions, per-bot
access, untrusted records, action retries and holds, the real outbound gate,
local proactive watch/brief and the settings DOM. The end-to-end test launches
only a temporary app server with `OMB_DATA_DIR` set by `launchVerificationServer`;
its fake Claude CLI calls the real Google stdio proxy and the native approval
routes. It does not launch Electron or touch an installed application's data.

Existing files changed outside the new connector, Google service and settings
files are listed below. All other implementation is additive. LICENSE, NOTICE
and third_party are untouched; no dependencies or git configuration changed.

- `vite.config.ts`: discover connector tests.
- `server/contracts.ts`: the Google built-in mount contract.
- `server/drivers/claude.ts`, `codex.ts`, `pi-mcp-servers.ts`, `turn-mcp.ts`,
  `chat-mcp-tools.ts`, `acp/grok.ts`: mount the built-in; Google owns its action
  holds so drafts bypass extra connector cards. Codex's timeout covers the hold.
- `server/harness-budget.ts`, `harness-mcp-proxy.ts`, `harness-mcp-request.ts`,
  `harness-mcp-token.ts`: the Google proxy family and its approval-wait budget.
- `server/index.ts`: service boot/shutdown, per-turn capabilities, owner routes,
  internal RPC authorization, native approval holds, tool listing and proactive
  wiring. The cloud-secrets boot import remains first.
- `server/host/proactive.ts`: inject direct reads and local triage instead of the
  upstream broker and helper relay for this integration.
- `server/host/brief-cards.ts`: distinguish repeated sender action labels, which
  otherwise make the demo brief fail widget validation.
- `server/read-and-draft.ts`: admit the direct MCP route and fence its read/draft
  tools to checked threads, refusing sends and Calendar changes unattended.
- `server/mcp-gate.test.ts`: exercise Full-access rejection of actual Google tool
  names before upstream execution, with reads/drafts still allowed.
- `server/workspace-backup-policy.ts`, `workspace-backup-policy.test.ts`: exclude
  Google ciphertext and its key, including temporary atomic-write files.
- `shared/mcp-name.ts`: reserve the Google built-in identity.
- `shared/outbound.ts`: classify the actual direct read, draft, send and Calendar
  tool names, including MCP-qualified names.
- `src/components/SettingsModal.tsx`: include Google settings and search terms.

Final type and static checks passed (exit 0, no diagnostics):

```sh
NODE_OPTIONS=--max-old-space-size=3500 npx tsc -p tsconfig.server.json --noEmit
NODE_OPTIONS=--max-old-space-size=3500 npx tsc -b --pretty false
NODE_OPTIONS=--max-old-space-size=1500 npx oxlint --deny-warnings server/google server/routes/google.ts shared/google.ts src/components/GoogleConnectionSettings.tsx src/components/GoogleConnectionSettings.test.ts
git diff --check
```

The first server type check reported two TS7053 errors because the proxy timeout
map did not yet include `google`; the map was corrected and the final check
passed. Intermediate focused runs also caught scope-probe expectation changes,
a wrong demo sent-mail baseline, a settings component import/polling problem,
and the duplicate-sender brief failure described above. All were resolved before
the 228-test run. No full-suite run, packaging or Electron verification was done.
