# Desktop browser tests

From the repository root, run:

```sh
pnpm install
pnpm test:ui
```

The package command is `pnpm --filter @relayit/e2e test`. Node 26 and Google Chrome are required. If Chrome is missing, all UI tests are skipped with an installation message; other browser startup failures fail the suite.

The root lockfile is outside this task's allowed file scope, so it is not included in the change. Use `pnpm install` to generate the new workspace importer; a frozen-lockfile install needs that importer committed separately.

The suite runs the real desktop React app against an in-process core with its offline model and built-in demo connectors. One Chrome process and Vite server are shared within the test file. Every test gets a fresh browser context, core instance, temporary data directory, and encryption key. The persistence test alone restarts core with the same data and key. Core reuses its assigned port so Vite's configured endpoint stays valid. All resources and temporary data are removed at suite teardown, including on test failure.

Tests cover onboarding, one-time approval, refusal, money holds and UPI confirmation, spending limits, approval-rule revocation, secret visibility, persisted chats, demo inbox triage, routines, and dark backgrounds. Both browser console errors and uncaught exceptions fail the current test. Background morning briefs and notifications are disabled for deterministic runs. Payment tests only use the local demo flow.

The secrets test saves a synthetic Exa key through the write-only extra-key endpoint, checks rendered HTML and state, and verifies Model inputs clear after reload. It does not save an Anthropic key or contact a model provider for validation.

## App issues

The three demo-note tests (allow once + Activity, refuse + Activity, and Always allow + revoke) are written but skipped because their shared initial approval-card flow has an intermittent app defect. The other eight tests run normally.

- `apps/desktop/src/lib/live.ts:100` (also lines 109 and 129), with `apps/desktop/src/screens/Chat.tsx:42`: a fast demo can emit `action.pending`, the assistant's `message.created`, and `run.finished` while the conversation's first query is still in flight. Browser tracing confirmed all events arrived before the first query response, core had saved the pending action and assistant message, and Chat still displayed only the user message after five seconds. The initial result can overwrite those invalidations, and Chat has no polling fallback. Suggested fix: cancel and refetch the conversation query on these events even when its initial fetch is pending, or schedule a follow-up fetch after that initial request settles. Re-enable the three skipped tests after the app fix; do not work around it by reloading Chat in the tests.
- `apps/desktop/src/screens/Settings.tsx:224`: Model emits Radix's uncontrolled-to-controlled Select warning as the saved model loads. Suggested fix: keep its value controlled from the first render (for example, use `value={model}` rather than `value={model || undefined}`). This is a warning, so the secrets test still runs.
