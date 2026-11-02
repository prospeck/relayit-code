import { INDIA_FREE_TOOLS, INDIA_SERVICES } from "../shared/india-services.ts";
import { resolveProxy, AGENTS_NODE_FLAG } from "./proxy-paths.ts";
import type { StoredStdioMcpServer } from "./mcp-registry.ts";

export function indiaServiceSpec(id: string, dataDir: string, credentialId?: string, mockCheckoutBaseUrl?: string): { name: string; server: StoredStdioMcpServer } | null {
  const service = INDIA_SERVICES.find((service) => service.id === id);
  if (!service) return null;
  return {
    name: service.name,
    server: { command: process.execPath, args: ["--experimental-strip-types", resolveProxy("india-connectors"), id, dataDir, ...(credentialId ? [credentialId] : [])], env: { ...AGENTS_NODE_FLAG, ...(service.id === "payments" && !credentialId && mockCheckoutBaseUrl ? { RELAYIT_MOCK_CHECKOUT_BASE_URL: mockCheckoutBaseUrl } : {}) }, enabled: false },
  };
}

/** Trust the shipped launcher, never just a configured MCP server's name or an argument it mentions. */
export function isShippedIndiaConnector(name: string, server: unknown): boolean {
  const spec = server as { command?: unknown; args?: unknown; env?: unknown } | null;
  const service = INDIA_SERVICES.find((service) => service.name === name);
  const env = spec?.env;
  const shippedEnv = env !== null && typeof env === "object" && !Array.isArray(env)
    && Object.entries(env).every(([key, value]) => (Object.hasOwn(AGENTS_NODE_FLAG, key) && value === AGENTS_NODE_FLAG[key as keyof typeof AGENTS_NODE_FLAG])
      || (service?.id === "payments" && key === "RELAYIT_MOCK_CHECKOUT_BASE_URL" && typeof value === "string" && /^http:\/\/127\.0\.0\.1:\d+\/api\/india\/mock-checkout\/v1$/.test(value)));
  return Boolean(service && shippedEnv && spec?.command === process.execPath && Array.isArray(spec.args)
    && spec.args[0] === "--experimental-strip-types" && spec.args[1] === resolveProxy("india-connectors")
    && spec.args[2] === service.id && typeof spec.args[3] === "string" && spec.args[3].length > 0
    && (spec.args.length === 4 || service.id === "payments" && spec.args.length === 5));
}

/** The tools that run without a card, only for the connector we ship: a configured server can take its name, not its file. */
export function indiaFreeTools(name: string, server: unknown): ReadonlySet<string> | undefined {
  return isShippedIndiaConnector(name, server) ? INDIA_FREE_TOOLS[name] : undefined;
}
