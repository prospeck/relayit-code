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
