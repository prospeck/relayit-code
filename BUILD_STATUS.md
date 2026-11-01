# Build status

Living checklist for the autonomous build. ✅ done · 🔨 in progress · ⏳ not started

## Phase 0/1 — Design system + foundation ✅
- ✅ core: SQLite store + migrations, AES-256-GCM secrets, model adapters (Anthropic, OpenAI-compatible: OpenAI/Gemini/OpenRouter/Ollama, mock), agent loop with read/prepare/act, approvals, taint tracking, spend cap, idempotency, resumable runs, audit log with redaction, HTTP + WebSocket API
- ✅ desktop: Tauri shell, keychain master key → core over stdin, sidecar lifecycle, tray, ⌥Space Quick Ask, close-to-tray
- ✅ UI: design system (light/dark), onboarding, Today, chat (streaming, steps, quick replies), approval receipts (hold-to-approve for money), activity, settings (profile, model, approvals, memory, brief, browser, privacy)
- ✅ demo prepare/act tools; core unit + e2e tests (Codex A)

## Phase 2 — Gmail + Calendar ✅
- ✅ connector (Codex B): OAuth loopback+PKCE, client, fake Google, tools, triage
- ✅ core integration: real + demo inbox, triage → Tasks, first-day intro, Today calendar
- ✅ Tasks screen

## Phase 3 — Connections, food, payments, trains ✅
- ✅ food + travel MCP servers (Codex A), payments connector (Codex C)
- ✅ MCP manager: stdio + remote HTTP with OAuth, official presets (Swiggy Food/Instamart/Dineout, Zomato, Wispr Flow, Notion, Linear), per-tool class + enable
- ✅ UPI QR + Razorpay test/mock checkout, payment watch → order confirmed
- ✅ Connections screen

## Phase 4 — Browser agent ✅ (Playwright, separate profile, act-gated submits, payment hand-off; 61 tests on real Chrome)
## Phase 5 — Proactive ✅ brief, routines (+ create_routine tool), skills, notifications, tray brief
## Phase 6 — Memory ✅ (also shown on approval cards) · voice ✅ · web research ✅ · first-day intro ✅

## Release ✅
- scripts/bundle-core.mjs (esbuild core + MCP servers, verified official Node sidecar); release .app verified running
- README, .env.example, UI e2e (11 tests), core tests (78), connectors (~270)
- Verified with a real local model (qwen3:4b via Ollama): pizza order reaches the approval card

## Round 3 ✅
- CI on GitHub Actions: macOS + Windows checks (typecheck, lint, format, tests), UI e2e on macOS, app/NSIS bundles uploaded as artifacts — all green
- Windows compatibility fixes (env for child processes, shutdown via stdin, paths, voice binaries, Edge)
- Accessibility pass (WCAG 2.1 AA): docs/a11y-audit.md findings applied; e2e/a11y.test.ts (172 checks) green
- Intent eval harness (evals/) against Ollama; findings applied (transcript bug, routing, tool guidance, grounding)
- Prettier across the repo; `pnpm dmg` builds a drag-to-Applications DMG

## Round 4 — fast local models ✅
- Native Ollama adapter (8k context, per-model thinking, patient loading); qwen3:4b-instruct recommended with one-click download in onboarding/settings
- Small-model robustness: stall nudges, text tool-call recovery, refused-action guard, explicit dates, flat tool schemas
- Eval: 13/18 with a 4B local model on an 8 GB M1 (evals/FINDINGS.md); browser submit race fixed (Codex C)

## Totals
- ~390 unit/API tests, 198 browser e2e tests (incl. accessibility), all passing locally and in CI
