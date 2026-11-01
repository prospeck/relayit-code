# RelayIt intent evals

Run from the repository root with Node 26 and the workspace dependencies installed:

```sh
pnpm evals
pnpm evals --only food-restaurant
pnpm evals --only email-explicit --repeat 3
pnpm evals --model qwen3:4b --provider ollama --base-url http://127.0.0.1:11434
pnpm evals --resume results/<timestamp>-<model>.json
pnpm --filter @relayit/evals test
pnpm --filter @relayit/evals typecheck
node evals/check-results.ts evals/results/<timestamp>-<model>.json
```

This package was added without changing the root lockfile, as required by the task's file scope. To link it using an existing local package store without changing that lockfile:

```sh
pnpm install --offline --lockfile=false --ignore-scripts
```

The default model is the real local `qwen3:4b`, using core's existing OpenAI-compatible adapter. The runner checks that Ollama responds and that the model is installed; it never downloads a model. Scenarios run sequentially with a ten minute deadline each, including follow-ups and refusal continuations. Slow runs are expected. Exit codes are 0 for every scenario passing, 1 for measured failures, and 2 for a startup/configuration failure.

`--resume` preserves completed attempts in an interrupted checkpoint and runs only missing attempts, each in fresh storage. Repeat the original model/provider/base URL/only/repeat flags when they differ from the defaults; mismatched configurations are rejected. The report records resume timestamps. An interrupted attempt that never reached a checkpoint is started again rather than counted as completed. `pnpm evals` runs inside the eval package, so its resume path starts with `results/`.

An explicitly selected alternative provider uses its corresponding environment key: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `OPENROUTER_API_KEY`. For example, `pnpm evals --provider anthropic --model <installed-or-available-model-id>`. No environment files are loaded or written. The key is passed to core's encrypted temporary secret store and deleted with the scenario data. The committed baseline uses only local Ollama. Fetches to non-loopback origins are blocked, except the origin of an explicitly selected remote model provider. The browser agent is disabled; no browser session is opened and no handoff links are followed.

Each scenario boots a real `App`, runs `loadPlugins`, uses `StaticKeyProvider` with a random temporary key, and onboards through core's in-process HTTP API. Google uses `fakeGoogleUrl: "auto"`. Food and travel run as the standard built-in MCP subprocesses. Each scenario has its own temporary database, connector storage and conversation, which are removed afterward. Aarav's Home and Work addresses, usual BBQ Chicken Pizza, non-vegetarian preference, train preference and fictional manager contact are seeded. All people, addresses and messages are synthetic.

Automatic startup inbox triage runs before the model is configured, so it uses the existing heuristic fallback. This avoids unrelated background inference competing with a scenario. The automatic daily brief is suppressed. User-requested `gmail_triage` still uses the real model/classifier and core's existing timeouts. No skills are explicitly activated: the benchmark tests ordinary chat, including the router and base prompt.

Every approval is refused, including cards created while processing a refusal. The dedicated change-of-mind scenario sends an explicit new request only after the first refusal continuation ends. The multi-intent scenario tests whether refusing one action leaves the other independent intent available. Routines and memory are prepare tools under the current contract, so they are expected to persist without a card. Train, metro and cab endpoints are read-only handoffs and are expected to produce links rather than approval cards.

`scenarios.ts` contains the prompts, regexes matching actual quick-reply buttons, required/forbidden tools, ordering constraints, card expectations, limits and payload checks. An unmatched quick reply is a failed check; the runner never invents a button or guesses a free-text answer. A vague email decision is deliberately left unspecified unless the agent asks; read its draft in the evidence to check for invented decisions.

The tool sequence comes from audit events in emission order: `tool.call` means execution, and `action.created` means an act request paused for approval. Act requests are included in sequence expectations without being counted as executions. Core does not audit rejected schemas or unknown tool names as `tool.call`; error feedback remains visible in each persisted run's messages and also fails the runtime check. The read-only checks inspect that feedback for rejected act attempts. Inspect transcripts as well, especially for the injection case.

Each checkpoint writes a timestamped JSON file and `results/latest.md`. The JSON includes raw audit evidence, run state (routing, model calls and errors), assistant text, cards and payloads, quick-reply taps, persisted memory/routines, per-check scores, timing, and token usage. `finalAssistantText` is the last assistant text after refusal; `texts` retains all preceding text and its phase. `intentWallTimeMs` is the time to the initial endpoint (`null` if it was never reached; the first baseline used `0` as that sentinel); `wallTimeMs` also includes refusal cleanup and a requested change of mind. Model-step limits exclude inference used solely to process refusals. Tokens include those continuations, using persisted provider usage; interrupted requests may not report usage. The runner sets its own process timezone to Asia/Kolkata so cron and relative dates agree across hosts.

Question limits count `offer_quick_replies` before the first card, or all such calls if there is no card. Plain-text questions and the exact wording of a question are retained for manual review. The premature-success check is a conservative English regex, not a semantic judge; inspect transcripts for unsupported decisions, translated claims and claims such as "on its way". Runtime/tool errors fail even if the model recovers. Pass rates describe only the selected attempts; flakiness is reported only when repetitions contain both passes and failures. One full run cannot establish reliability.

`check-results.ts` validates a completed artifact, recalculates checks using the current scorer, and rewrites its summary and `latest.md`. It preserves the inference evidence and labels the result with a grading timestamp and note. This permits fixing a scoring omission without rerunning a slow model. It does not turn a failed model run into a new inference attempt.
