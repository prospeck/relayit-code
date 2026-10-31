# Decisions

Product and engineering calls made during the build, newest last.

1. **Browser agent is a fallback, not banned.** The brief's principle 7 forbade automating Swiggy/Zomato/etc.; the owner then asked for exactly that. Rule now: official route first (MCP / API / ONDC / deep link); otherwise the browser agent drives the user's *own* logged-in session in a separate Chromium profile, visibly, with approval at every submit/checkout, and never enters payment details. Known risk: may breach those sites' terms and break when their UI changes.
2. **Core runs on Node with native TypeScript type stripping** (no build step in dev). Released apps bundle core with esbuild and ship it with a Node runtime as a Tauri sidecar.
3. **SQLite via Node's built-in `node:sqlite`** with Kysely through a tiny adapter — no native modules to rebuild per platform.
4. **The master key lives in the OS keychain, read by the Tauri (Rust) shell** and handed to core over stdin at launch. Core never touches the keychain directly, so the same core can later run in the cloud with a KMS-backed `KeyProvider`.
5. **Model adapters are hand-written** (Anthropic Messages API + one OpenAI-compatible adapter that covers OpenAI, Gemini's OpenAI endpoint, OpenRouter and Ollama). Fewer dependencies, full control over streaming tool calls.
6. **Taint tracking for prompt injection.** Once a run has read untrusted content (email, web page, browser), "Always allow" rules are suspended for the rest of that run and every `act` needs an explicit click. The card says why.
7. **Money is never auto-approved** and money actions above the per-action spending cap cannot be approved until the cap is raised in Settings.
8. **Google and Payments are native (in-process) connectors; Food and Travel are MCP servers.** Native where OAuth tokens / encrypted secrets / QR rendering are needed; MCP everywhere else, so third-party servers plug in the same way.
9. **MCP tools carry RelayIt `_meta`** (`relayit/class`, `relayit/previewTool`, …). Approval cards for MCP `act` tools are built by calling a server-side preview tool, so amounts on cards come from the server, never from model-written arguments.
10. **Profile, addresses, model config and settings live in a key-value table** rather than separate tables; they are single-row documents.
