import { INDIA_FREE_TOOLS, INDIA_SERVICES } from "../shared/india-services.ts";
import { resolveProxy, AGENTS_NODE_FLAG } from "./proxy-paths.ts";
import type { StoredStdioMcpServer } from "./mcp-registry.ts";

export function indiaServiceSpec(id: string, dataDir: string, credentialId?: string): { name: string; server: StoredStdioMcpServer } | null {
  const service = INDIA_SERVICES.find((service) => service.id === id);
  if (!service) return null;
  return {
    name: service.name,
    server: { command: process.execPath, args: ["--experimental-strip-types", resolveProxy("india-connectors"), id, dataDir, ...(credentialId ? [credentialId] : [])], env: AGENTS_NODE_FLAG, enabled: false },
  };
}

/** The tools that run without a card, only for the connector we ship: a configured server can take its name, not its file. */
export function indiaFreeTools(name: string, server: unknown): ReadonlySet<string> | undefined {
  const args = (server as { args?: unknown } | null)?.args;
  return Array.isArray(args) && args.includes(resolveProxy("india-connectors")) ? INDIA_FREE_TOOLS[name] : undefined;
}
