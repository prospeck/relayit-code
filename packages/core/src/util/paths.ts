import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Where RelayIt's built-in MCP servers live.
 * Bundled app: `core/connectors/<name>.mjs` next to main.mjs. Dev: the package's TypeScript source.
 */
export function builtinServer(name: string): { command: string; args: string[] } {
  const bundled = fileURLToPath(new URL(`./connectors/${name}.mjs`, import.meta.url));
  if (existsSync(bundled)) return { command: process.execPath, args: [bundled] };
  const src = fileURLToPath(
    new URL(`../../../../connectors/${name}/src/server.ts`, import.meta.url),
  );
  return { command: process.execPath, args: [src] };
}
