# RelayIt

**Say it once. RelayIt handles the rest.**

RelayIt is a personal AI agent for your desktop (macOS and Windows), built for India. Tell it what you want in plain words — *"order something from California Pizza"*, *"reply to my manager and find a slot on Thursday"*, *"find a train to Mysuru tomorrow morning"* — and it gets it done across your apps. It also reaches out first with a morning brief and "this needs you" alerts.

It never sends, pays, books or deletes anything without your OK. It never touches your money: it prepares the order and hands you a UPI QR to pay in your own app. Everything stays on your computer.

## Quick start (under 10 commands)

Needs **Node 24+** (26 recommended), **pnpm**, and for the desktop app **Rust** ([rustup.rs](https://rustup.rs)).

```bash
git clone https://github.com/prospeck/relayit-code.git && cd relayit-code
pnpm install
pnpm dev -- --mock --fake-google      # engine + web UI with the offline demo model and a fake inbox
# open http://127.0.0.1:1420
```

The demo model follows a few scripted flows — try **"Try a demo action"** or **"Order something from California Pizza"**.

### Run the desktop app

```bash
RELAYIT_MOCK_MODEL=1 RELAYIT_FAKE_GOOGLE=1 pnpm tauri dev   # drop the env vars to use a real model
pnpm tauri build                                            # release build (.app / .dmg / .msi)
```

### Use a real model

During onboarding (or **Settings → Model**) pick a provider and paste a key — Anthropic, OpenAI, Google Gemini or OpenRouter. The key is checked with a free "list models" call, encrypted, and never shown again. You can also choose a cheaper model for routing and summaries.

### Run fully local with Ollama

```bash
brew install ollama   # or download from ollama.com
ollama serve & ollama pull qwen3
pnpm dev               # pick "Ollama" in onboarding — it's detected automatically
```

Pick a model with good tool calling (Qwen 3, Llama 3.1+, Mistral Small).

### Fake Google mode

`RELAYIT_FAKE_GOOGLE=1` (or **Connections → Try a demo inbox**) runs a local fake Gmail + Calendar with an invented inbox, so triage, replies and the calendar work with no Google account. For a real account, create a Google OAuth client of type **Desktop app**, enable the Gmail and Calendar APIs, add yourself as a test user, and paste the client ID/secret in **Connections → Connect Google** (or set `RELAYIT_GOOGLE_CLIENT_ID` / `RELAYIT_GOOGLE_CLIENT_SECRET`).

## Checks

```bash
pnpm typecheck   # TypeScript strict, every package
pnpm lint        # ESLint
pnpm test        # unit + API end-to-end tests (no keys or network needed)
pnpm test:ui     # browser end-to-end tests (needs Google Chrome)
```

## How it's built

```
apps/desktop          Tauri v2 shell (Rust) + React UI
packages/core         the engine: agent loop, approvals, models, MCP client, memory, scheduler, API
packages/shared       types and Zod schemas shared by UI, engine and connectors
connectors/google     Gmail + Calendar (OAuth loopback + PKCE), fake Google, triage
connectors/food       food-ordering MCP server (mock Bengaluru restaurants, ONDC-ready interface)
connectors/travel     trains (IRCTC hand-off), Namma Metro routes, cab deep links (MCP server)
connectors/payments   UPI QR + Razorpay test-mode links, local test checkout
connectors/browser    browser agent for sites without an API (separate Chromium profile)
connectors/web        web research (Exa) + readable page fetch
connectors/voice      push-to-talk transcription (local whisper.cpp, Groq or OpenAI)
```

- **The engine runs as a local sidecar.** The Tauri shell reads a master key from the OS keychain, starts the engine, and hands it the key over stdin. The engine serves HTTP + WebSocket on `127.0.0.1` with a random per-launch token; the UI only talks to that API. The same engine can later run in the cloud for a phone app.
- **Approvals.** Every tool is `read`, `prepare` or `act`. `act` tools pause the run and show a card — *Allow once / Always allow / Refuse*. Money always asks (hold-to-approve), is capped per action, and is never auto-approved. If a task has read outside content (email, web pages), "Always allow" is suspended for the rest of that task.
- **Outside content is data.** Tool results are wrapped as `<untrusted_data>` and the model is told never to follow instructions inside them.
- **Connections.** RelayIt is an MCP client. Official servers come first (Swiggy, Zomato, Wispr Flow, Notion, Linear are one click); any MCP server can be added by URL or command, and each of its tools can be reclassified. Unknown tools default to `act`.
- **Data.** SQLite (`node:sqlite`) in the app data folder; secrets AES-256-GCM encrypted; audit log with secrets redacted.

See [`DECISIONS.md`](DECISIONS.md) for the product and engineering calls, and [`docs/connector-contract.md`](docs/connector-contract.md) for writing connectors.
