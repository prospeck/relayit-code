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

## Phase 4 — Browser agent 🔨 (Codex B building connector)
## Phase 5 — Proactive ✅ brief, routines (+ create_routine tool), skills, notifications
## Phase 6 — Memory ✅ · voice 🔨 · web research 🔨 (Codex C) · first-day intro ✅

## Remaining
- integrate browser + web + voice connectors
- bundle script for release builds (esbuild core + connectors, Node sidecar)
- README, .env.example, UI e2e
