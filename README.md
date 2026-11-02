# RelayIt

**Say it once. RelayIt handles the rest.**

A personal AI agent for your computer, built for India. Tell it what you want in plain language: "Order something from California Pizza", "What needs me today?", "Block 30 minutes for the gym". It works out the steps, and asks before it spends money or sends anything.

## What it does

- **Bring your own model.** Use the Claude or Codex app you're already signed in to, an API key, or a model running on your own machine through Ollama.
- **Asks first.** New chats start on Ask. Sends and money always ask, at every level. In a browser, the press that spends money is yours.
- **Local first.** Your data stays on your computer, and credentials are encrypted at rest.
- **Knows India.** Swiggy, Zomato and Wispr Flow through their official connections; trains, Namma Metro and UPI handoffs; direct Gmail and Google Calendar with no third party in between.
- **Works while you don't.** Routines, triggers, and a morning brief.
- **A team if you want one.** Several bots, each with its own model, memory and apps, in one chat app.

Food and travel use demo data until an official connection is signed in. RelayIt never handles your money: it shows a UPI QR or link, and you pay in your own app.

## Run it

Needs Node 24+ and pnpm.

```sh
pnpm install
pnpm dev:server   # the local server
pnpm dev          # the app, at http://127.0.0.1:5199
pnpm dev:desktop  # the desktop shell; keep the other two running
```

### Run a model on your own machine

```sh
ollama serve
ollama pull qwen3:4b-instruct   # 2.5 GB; works on an 8 GB Mac
```

Add `http://127.0.0.1:11434/v1` as an OpenAI-compatible server in Settings. On machines up to 16 GB, RelayIt gives a local model a shorter prompt and tool list and sizes its context window to the machine.

## Licence

RelayIt is built on [RelayIt](UPSTREAM.md), used under the Apache License 2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE) and [UPSTREAM.md](UPSTREAM.md).
