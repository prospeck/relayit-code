# Connector contract

RelayIt talks to services in two ways:

1. **MCP connectors** (`connectors/food`, `connectors/travel`, any third-party MCP server). Core launches them over stdio (or connects over HTTP) with `@modelcontextprotocol/sdk`.
2. **Native connectors** (`connectors/google`, `connectors/payments`, `connectors/browser`). Plain TypeScript packages exporting `ToolDef[]` (see `packages/shared/src/tools.ts`), loaded in-process because they need OAuth tokens, encrypted secrets or a live browser.

## MCP tool metadata (RelayIt extension)

Each tool on a RelayIt MCP server sets `_meta` on its tool definition:

| key | value | meaning |
|---|---|---|
| `relayit/class` | `"read" \| "prepare" \| "act"` | Approval class. Missing → treated as `act`. |
| `relayit/service` | e.g. `"Swiggy"` | Shown on cards and in Activity. |
| `relayit/money` | `true` | Involves money; never auto-approved. |
| `relayit/previewTool` | tool name | For `act` tools: a **read** tool on the same server that accepts the *same arguments* and returns a JSON `ActPreview` (`{title, summary, service, recipient?, amountInr?, details?: {label,value}[]}`) as its text content. Core calls it to build the approval card, so card data comes from the server, not the model. |
| `relayit/internal` | `true` | Called only by core (e.g. confirming a payment); hidden from the model. |
| `relayit/label` | e.g. `"Searching restaurants"` | Step label in the UI timeline. |

Third-party servers without `_meta` get every tool defaulted to `act` until the user reclassifies it in Connections.

## Result conventions

- Return one `text` content item containing JSON.
- Errors: `isError: true` with a human-readable message the model can act on.
- `act` tools receive an `idempotencyKey` string argument injected by core (declare it as an optional string in the input schema). Repeating a call with the same key must return the original result without repeating the side effect.

## Rich parts

A tool result JSON may include `"_parts": MessagePart[]` (see `packages/shared/src/index.ts`) for links or payment QR codes; core strips it before passing the result to the model and attaches it to the reply.
