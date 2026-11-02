# India services handoff

Worktree: `/Users/work/relayit-next-india`, branch `relayit-next-india`.
No push, git configuration change, desktop launch, dev server, full suite or app
packaging was performed. LICENSE, NOTICE and third_party were not changed.
Tests used disposable homes/data directories and loopback mock services, never
the installed app's data or real accounts.

## Changed files

New connector files retain the original RelayIt providers and their tests:

- `food/src/provider.ts`, `mock/data.ts`, `mock/provider.ts`, `ondc.ts`: provider
  contracts, Bengaluru demo catalogue, durable mock carts/orders and ONDC stub.
- `food/src/server.ts`, `food/src/tools.ts`, `food/tests/food.test.ts`: MCP factory,
  standard read/mutation annotations and provider/MCP tests. Payment confirmation
  is not exposed to the model. Mock state reloads across stdio processes.
- `travel/src/provider.ts`, `mock/provider.ts`, `mock/stations.ts`,
  `mock/trains.ts`, `mock/metro.ts`: original mock travel data and handoffs.
- `travel/src/server.ts`, `travel/src/tools.ts`, `travel/tests/travel.test.ts`:
  MCP factory, read annotations and original travel tests.
- `payments/src/upi.ts`, `qr.ts`, `razorpay.ts`, `mockCheckout.ts`, `service.ts`,
  `index.ts`: UPI and QR generation, test-only Razorpay, loopback checkout and
  payment lifecycle. Checkout reconciliation verifies reference and amount.
- `payments/src/server.ts`, `tools.ts`, `store.ts`, `food-payment.ts`: MCP tools,
  SQLite persistence and matched paid-demo-order reconciliation.
- `payments/tests/{upi,razorpay,service,tools,store,food-payment}.test.ts`:
  provider, validation, persistence, MCP and reconciliation tests. Payment tools
  use MCP tests in place of the old app-specific tool registry.

Other new files, relative to the repository root:

- `shared/mcp-presets.ts`, `src/components/McpPresetCards.tsx`,
  `src/components/McpServersPanel.presets.test.ts`: seven official connection cards
  and existing OAuth/discovery integration tests using mocks.
- `shared/india-services.ts`, `server/india-services.ts`,
  `server/india-connectors.ts`, `server/routes/india-services.ts`,
  `src/components/IndiaServiceCards.tsx`: optional shipped stdio server registration,
  local launcher and encrypted, write-only test-key settings.
- `server/india-services.test.ts`: stdio mock food-to-payment flow, travel discovery,
  restart persistence and a focused standalone entry bundling check.
- `shared/payment-request.ts`, `src/lib/payment-request.ts`,
  `src/components/PaymentRequestCard.tsx`, `PaymentRequestCard.test.ts`: payment
  display contract, strict URI/payee/amount/checkout validation and safe QR rendering.
  Parsing covers Claude MCP, Codex bare names, ACP content and native API result wrappers.
- `server/browser/recipes.ts`, `recipes.test.ts`: six hostname-scoped service guides.
- `server/browser/sensitive-fields.ts`, `sensitive-fields.e2e.test.ts`: bot input
  refusal, including focused typing and evaluation on sensitive forms; real Chrome
  verifies refusal, unchanged field values, trusted human input and money-button refusal.
- `server/india-prompt.ts`, `india-prompt.test.ts`: Indian defaults, grounded food
  intent, exact payment handoff values and mandatory approvals/untrusted-data rules.
- `scripts/verify-india-services.sh`: bounded sequential verification commands.
- `connectors/README.md`, `connectors/VERIFICATION.md`: usage, limitations and handoff.

Every pre-existing file changed outside the additive files above:

- `package.json`, `pnpm-lock.yaml`: MCP SDK, QR generator and QR typings.
- `tsconfig.server.json`, `vite.config.ts`: include the new connectors in types/tests.
- `scripts/bundle-server.mjs`: include the connector launcher entry.
- `server/index.ts`: pass the existing LoginStore instance to MCP settings routes.
- `server/routes/mcp-servers.ts`: delegate optional builtin setup to its focused route.
- `server/routes/mcp-servers.test.ts`: registration, test-key rejection, write-only
  configuration and encrypted-on-disk assertions.
- `server/system-prompt.ts`: attach Indian first-run defaults and connector instructions.
- `server/browser/dispatch.ts`: add service hints and sensitive-input guards, retaining
  existing spending-button refusals.
- `server/browser/service.ts`: enforce the same refusal for the saved-login text
  insertion path; direct human browser input remains available.
- `server/browser/cdp/sensitive.ts`: cover UPI, compact PIN names and labelled codes.
- `server/browser/prompt.ts`: visible-browser sign-in and person-only spending guidance.
- `server/browser/testing/fake-chrome.ts`: answer the added field metadata probes.
- `server/browser/passkey-wall.e2e.test.ts`: assert bot OTP refusal and simulate human
  entry for the existing sign-in fixture.
- `shared/outbound.ts`: add only PAYMENTS and PAID to money words; no semantic changes.
- `shared/outbound.test.ts`: India order, booking and payment money-approval assertions.
- `src/components/McpServersPanel.tsx`: mount cards and reuse existing save/test/OAuth.
- `src/components/McpServersPanel.live.test.ts`: identify actual server rows rather than
  matching the word “notes” in the new Wispr description.
- `src/components/ToolActivity.tsx`: display validated payment cards outside tool details.
- `src/locales/en.json`: new English strings; other locales use the existing fallback.

## Verification

The repeatable command is `bash scripts/verify-india-services.sh`. That script
contains the complete file selection and exact commands, including:

- `NODE_OPTIONS=--max-old-space-size=1500 npx vitest run ... --no-file-parallelism --maxWorkers=1`
- `NODE_OPTIONS=--max-old-space-size=1500 OMB_CDP_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npx vitest run server/browser/sensitive-fields.e2e.test.ts server/browser/passkey-wall.e2e.test.ts --no-file-parallelism --maxWorkers=1`
- `NODE_OPTIONS=--max-old-space-size=3500 npx tsc -p tsconfig.server.json --noEmit`
- `NODE_OPTIONS=--max-old-space-size=3500 npx tsc -b --pretty false`
- `NODE_OPTIONS=--max-old-space-size=1500 node scripts/generate-locale.mjs --check`
- Focused `NODE_OPTIONS=--max-old-space-size=1500 npx oxlint --deny-warnings ...`
- `git diff --check`

The shared node_modules symlink was replaced with this worktree's own dependency
installation before adding dependencies. `pnpm install --ignore-scripts` passed.
No installation was run through the shared symlink.

Final focused test results from the script: 27 files / 381 tests passed; real Chrome 2 files / 5 tests
passed, zero skips. After adapting native driver projections,
`NODE_OPTIONS=--max-old-space-size=1500 npx vitest run src/components/PaymentRequestCard.test.ts server/india-prompt.test.ts --no-file-parallelism --maxWorkers=1`
also passed: 2 files / 10 tests. These verify mocks, protocol contracts, prompts, URI/card
rendering and fixtures; they do not qualify live vendor integration or a complete
model-driven order in the desktop UI.

Earlier focused checks exposed and then resolved these failures:

```text
Cannot read properties of null (reading 'some')
SyntaxError: Identifier '__require' has already been declared
expected ... not to contain 'notes'
```

The fake browser needed metadata responses; the bundling probe's require helper
collided with esbuild; a panel assertion matched Wispr's description. The final
checks include all affected files. A repeated server type check was also stopped
with `Terminated: 15` when three worktrees were type-checking and the machine
was swapping heavily. The script was restarted, passed its test stages again,
then its repeated server type check was stopped after over eight minutes under
renewed concurrent-worker swap pressure, also with exit 143. This was an
intentional stop, not a passing check or an out-of-memory success.

Earlier standalone server and app TypeScript commands both exited 0, before
the final saved-login guard and native-driver parsing changes. Those final
changes have focused test coverage but do not have a completed final full type
check. The stopped scripts did not reach their later type/locale/lint stages.
The locale check, focused lint (including the final browser guards), and
`git diff --check` were run separately and passed after the final edits.

## Not verified or intentionally mock-only

No real Swiggy, Zomato, UPI, Razorpay account or service website was used. Official
URLs are ported source data, not verified availability. ONDC remains the original
unimplemented adapter. Food, train and metro data are mocks. Browser recipes are
hints, not tested live ordering flows. Prompt behavior has deterministic assertions,
not a live LLM acceptance run. Payment cards have render tests; the desktop was
not launched. Only the connector entry was bundled in a temporary test directory;
no desktop package was built.

UPI assertions never independently verify a bank payment and never confirm an
order. All Razorpay confirmations here are test-mode confirmations. Default mock
checkout links last only for the running connector process; pending links do not
survive its restart. Settled payment records do persist.

## Implementation commits

- d1acd34 Add official MCP connection cards using existing OAuth
- 905bc99 Add local MCP and payment QR dependencies
- 1d3c324 Port mock food and travel tools with MCP safety annotations
- 0b04e82 Keep official connection status tied to OAuth sign-in
- 0cd30b5 Ship optional India stdio services and UPI payment cards
- 34cd88e Add India browser recipes and refuse bot input in secret fields
- 7859d26 Guide Indian service intent through grounded tools and approvals
- e729216 Apply secret-field refusal to saved-login insertion too
- 1f567c2 Connect approved food orders to exact payment request values
- 93f0f9e Render payment cards across native driver result formats
