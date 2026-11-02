# Local order cards — implementation and verification

Worktree: `/Users/work/relayit-next-cards`, branch `relayit-next-cards`.
Verified 2–3 November 2026 with `qwen3:4b-instruct`, real Ollama, real HTTP server and shipped mock connectors. All runs used temporary homes/data. No Electron, packaging, real accounts, payments, system installs, git configuration changes or pushes.

## Changes, file by file

- `connectors/food/src/tools.ts`: stored-cart preview names the actual items, restaurant and delivery destination; preview-only metadata hides its tool from the model.
- `connectors/payments/src/tools.ts`: declares previews for payment creation and user assertions; marks both preview tools as internal.
- `connectors/payments/src/server.ts`: accepts a server-side payment-request resolver.
- `server/india-connectors.ts`: resolves amount/payee from the saved food order; connects mock checkout to the main HTTP host when configured.
- `server/india-services.ts`: verifies the exact shipped launcher, service and environment before trusting previews/free reads; supplies the mock host URL only to payments.
- `server/tool-approval-preview.ts`: validates and formats server previews; refuses failed/malformed previews; formats third-party arguments with labels and secret redaction, including oversized input.
- `server/drivers/chat-mcp-tools.ts`: retains trusted preview declarations and calls them with the action's arguments; money/outbound tools cannot acquire session grants.
- `server/drivers/mcp-approval-preview.ts`: supplies the same preview behavior to native CLI permission requests using a separate, bounded preview connection.
- `server/drivers/claude.ts`: awaits preview before opening the permission card; denies failed previews; excludes outbound tools from session allowances.
- `server/drivers/openai-chat.ts`: uses preview summaries; checks the actual searched tool for Full access; stops locally on denial/preview failure without another model call; holds local replies until guards run; counts successful calls; removes obsolete menu/search replay after cart preparation. Exhausted factual guards stop safely instead of triggering an automatic retry that can place another order.
- `server/drivers/local-model-guard.ts`: checks unavailable-service and completion claims, menu-to-cart progression for explicit order requests, and payment handoff; permits a generated payment link without confusing it with paid status.
- `server/india-prompt.ts`: shorter instructions for mock orders, exact payment arguments, denial and settlement checks.
- `server/mcp-app-observer.ts`: hides preview-only tools from model-visible catalogs.
- `server/mcp-gate-config.ts`: keeps the shipped connector's catalog gate even with result trimming disabled.
- `src/components/PendingApproval.tsx`: shows the full readable MCP approval details in normal text, without the three-line command fold.
- `src/components/ApprovalCard.tsx`: removes the local India server prefix from displayed action words.
- `connectors/payments/src/mockCheckout.ts`: reusable HTTP handler; hosted checkout forms retain their URL prefix.
- `server/routes/india-services.ts`: hosts mock checkout in the main server so its lifetime spans MCP turns.
- `scripts/try-local-order.mjs`: `--approve`/`--deny` use `/api/threads/:id/respond`; validates and completes only localhost mock checkout; reads full tool output; prints stage timings and persisted order states; refuses a second order card; counts post-denial requests. Uses free ports and deletes only uniquely named copies that this invocation actually creates. Questions are reported rather than answered by guessing.
- `src/components/PaymentRequestCard.tsx`: pending demo requests show a QR for the local mock checkout, with a test-checkout heading. Payable UPI QR codes remain hidden for demos.
- `scripts/verify-order-cards.ts`, `scripts/testing/order-card-preview.tsx`: reproducible screenshots from shipped server previews and existing renderer components; preview buttons are inert.
- Tests changed/added: `server/drivers/{chat-mcp-tools,mcp-approval-preview,claude,local-model-guard,openai-chat-local-model,openai-chat-tools}.test.ts`, `server/india-services.test.ts`, `server/routes/mcp-servers.test.ts`, `connectors/payments/tests/tools.test.ts`, `src/components/PaymentRequestCard.test.ts`.

`shared/outbound.ts`, `server/auto-approve.ts`, LICENSE, NOTICE and third_party were not changed.

## Real-model runs

Command, repeated sequentially as fixes were made:

```sh
NODE_OPTIONS=--max-old-space-size=1500 node scripts/try-local-order.mjs 'Order something from California Pizza' 300 --approve
```

The fixture adds the explicit mock destination `Home, 12 Demo Road, Bengaluru` to the user request. Timings below are seconds after sending that request, excluding server boot. These are development runs across changing revisions, not a success-rate estimate for one frozen revision.

1. Card/approval 79; place_order 84; payment payload and mock checkout 112; ended 173. Persisted order still awaiting_payment. The model falsely claimed checks without tools. Early instrumentation missed the awaiting-payment timestamp because the transcript preview was clipped. Maximum estimate: 7,462 tokens.
2. Ended 49 before any order tool progress, falsely claiming unavailability. No orders. Maximum estimate: 5,122.
3. Ended 48 with another unavailability wording. No orders. Maximum estimate: 5,122.
4. Card/approval 72; placed/awaiting_payment 76; payment payload/mock checkout 101; confirmed order read 153; ended 226. One confirmed order. The script then unnecessarily sent another status turn; that was removed. Maximum estimate: 8,054, before replay compaction.
5. Card/approval 73; placed/awaiting_payment 77; payment payload/mock checkout 110; stopped at 303. Two awaiting-payment orders, none confirmed. Guard exhaustion triggered automatic recovery and a second order, and the per-turn mock checkout disappeared. Both defects were fixed. Maximum estimate: 6,786.
6. Manually stopped after about 90 seconds: a newly added mock-host environment value was mistakenly attached to food too, so strict launcher trust correctly rejected it and the card lacked a trusted preview. A mock order had already been placed. Fixed the descriptor construction. This partial run is excluded from the seven completed-run counts.
7. Ended 123 after menu lookups without preparing a cart. No orders. Added an explicit-order menu progression guard. Maximum estimate: 6,642.
8. Card/approval 117; placed/awaiting_payment 121; payment payload/mock checkout 150; payment reconciled and confirmed order read 191; ended 219. One confirmed order for ₹851. This exercised the hosted checkout across turns. Maximum estimate: 6,492.

Across seven completed approval attempts: approval card 4/7, placed order 4/7, awaiting payment 4/7 (including run 1's persisted state), payment payload 4/7, mock checkout 4/7, confirmed order 2/7. All seven plus the partial run are listed; no unsuccessful run was discarded. Early setup also hit the old fixed-port collision, and one overlapping request was stopped while the other worker was using Ollama.

Denial command:

```sh
NODE_OPTIONS=--max-old-space-size=1500 node scripts/try-local-order.mjs 'Order something from California Pizza' 300 --deny
```

Card denied at 95s; fixed refusal at 99s; ended 112s. Persisted orders: zero. Model tool requests after denial: zero. No retry or argument from the model.

Logs: `/tmp/relayit-cards-run1.log` through `run8.log`, and `/tmp/relayit-cards-deny.log`.

## Checks

Each Vitest command used `NODE_OPTIONS=--max-old-space-size=1500` and `--no-file-parallelism --maxWorkers=1`. No full suite was run.

```sh
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run server/drivers/chat-mcp-tools.test.ts server/drivers/chat-tool-approval.test.ts server/drivers/mcp-approval-preview.test.ts server/drivers/local-model-guard.test.ts server/drivers/openai-chat-local-model.test.ts server/india-services.test.ts src/components/PaymentRequestCard.test.ts server/india-prompt.test.ts shared/outbound.test.ts server/auto-approve.test.ts server/mcp-app-observer.test.ts --no-file-parallelism --maxWorkers=1
```

227 passed (11 files). This broader check preceded the last lifecycle/menu guard additions; those were checked below.

```sh
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run server/india-services.test.ts server/drivers/local-model-guard.test.ts server/drivers/mcp-approval-preview.test.ts connectors/payments/tests/tools.test.ts connectors/payments/tests/razorpay.test.ts connectors/payments/tests/food-payment.test.ts server/routes/mcp-servers.test.ts --no-file-parallelism --maxWorkers=1
```

69 passed (7 files), including hosted-checkout reconciliation after reconnect. The final native visibility case was subsequently checked below.

```sh
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run server/india-services.test.ts server/drivers/openai-chat-local-model.test.ts server/mcp-gate-config.test.ts --no-file-parallelism --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run server/drivers/claude.test.ts --testNamePattern='previews a shipped|unknown MCP tool|nested questions' --no-file-parallelism --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run server/drivers/openai-chat-tools.test.ts --testNamePattern='asks about the tool call_tool' --no-file-parallelism --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run server/drivers/local-model-guard.test.ts server/drivers/mcp-approval-preview.test.ts --no-file-parallelism --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run src/components/PaymentRequestCard.test.ts server/drivers/mcp-approval-preview.test.ts --no-file-parallelism --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run server/drivers/openai-chat-local-model.test.ts --no-file-parallelism --maxWorkers=1
```

Results respectively: 40 passed; 4 passed/235 skipped; 2 passed/121 skipped with zero unhandled errors; 25 passed; 12 passed; 20 passed (including the stalled-order regression). These overlap; do not add them into a unique-test count.

```sh
NODE_OPTIONS=--max-old-space-size=3500 npx tsc -p tsconfig.server.json --noEmit
NODE_OPTIONS=--max-old-space-size=3500 npx tsc -b
node --check scripts/try-local-order.mjs
git diff --check
NODE_OPTIONS=--max-old-space-size=1500 node --experimental-strip-types scripts/verify-order-cards.ts --capture
```

Both type checks passed (exit 0) without aborting. Syntax and diff checks passed. Screenshot capture passed for both themes: total visible, QR present, no horizontal overflow at 1050×1100. Images: `images/order-cards/light.png`, `images/order-cards/dark.png`; both were visually inspected.

Intermediate checks did fail and were corrected: TypeScript event narrowing/nullable closure; changed redaction/grant/tool-count expectations; a fake HTTP fixture parsing the Ollama GET probe as JSON; and a credential assertion still reading the legacy file instead of `.credentials/logins.enc`. The first screenshot attempt wrote its images but raced Chrome profile deletion; bounded cleanup retries fixed that. No type check aborted from memory pressure.

## Remaining limits

- Codex's native MCP permission path has not been wired to server previews. Chat Completions/local models and the Claude permission broker are implemented and tested. The Claude checks use the fake CLI; no live Claude sign-in was used.
- Small-model progression and final prose remain inconsistent. In run 8 the final model prose omitted the items and described the mock checkout as UPI; the approval card and stage counts use server facts, not that prose. A confirmed order is not a delivered order.
- Demo QR encodes localhost mock checkout, never a payable demo UPI URI. A user_confirmed UPI assertion does not confirm an order; tests verify this.
- Mock links live for the main server process, not across a main-server restart. Existing payment connector configurations without the host URL must be re-added to use this lifetime fix; fresh configurations used by the script have it.
- Screenshots mount the existing card components with server-generated mock facts, with inert fixture buttons. The real script tests the UI's approval HTTP route; Electron/packaged UI and real financial services were deliberately not exercised.
