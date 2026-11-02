import { INDIA_SERVICES } from "../shared/india-services.ts";
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
