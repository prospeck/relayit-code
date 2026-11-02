#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

focused=(
  connectors/food/tests/food.test.ts
  connectors/travel/tests/travel.test.ts
  connectors/payments/tests/
  shared/outbound.test.ts
  server/india-services.test.ts
  server/routes/mcp-servers.test.ts
  server/india-prompt.test.ts
  server/system-prompt.test.ts
  server/browser/recipes.test.ts
  server/browser/service.test.ts
  server/browser/viewers/core.test.ts
  server/browser/tools.test.ts
  server/browser/cdp/driver-parts.test.ts
  src/components/McpServersPanel
  src/components/PaymentRequestCard.test.ts
  src/components/ToolActivity.test.ts
)
NODE_OPTIONS=--max-old-space-size=1500 npx vitest run "${focused[@]}" --no-file-parallelism --maxWorkers=1

chrome="${OMB_CDP_CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [[ ! -x "$chrome" ]]; then
  echo 'Real-Chrome verification requires OMB_CDP_CHROME pointing to an executable.' >&2
  exit 1
fi
NODE_OPTIONS=--max-old-space-size=1500 OMB_CDP_CHROME="$chrome" npx vitest run \
  server/browser/sensitive-fields.e2e.test.ts server/browser/passkey-wall.e2e.test.ts \
  --no-file-parallelism --maxWorkers=1

NODE_OPTIONS=--max-old-space-size=3500 npx tsc -p tsconfig.server.json --noEmit
NODE_OPTIONS=--max-old-space-size=3500 npx tsc -b --pretty false
NODE_OPTIONS=--max-old-space-size=1500 node scripts/generate-locale.mjs --check
NODE_OPTIONS=--max-old-space-size=1500 npx oxlint --deny-warnings \
  connectors server/india-connectors.ts server/india-services.ts server/india-services.test.ts \
  server/india-prompt.ts server/india-prompt.test.ts server/routes/india-services.ts \
  server/browser/sensitive-fields.ts server/browser/recipes.ts \
  server/browser/service.ts server/browser/testing/fake-chrome.ts \
  server/browser/prompt.ts server/browser/dispatch.ts \
  src/components/McpPresetCards.tsx src/components/IndiaServiceCards.tsx \
  src/components/PaymentRequestCard.tsx src/lib/payment-request.ts \
  shared/mcp-presets.ts shared/india-services.ts shared/payment-request.ts

git diff --check
