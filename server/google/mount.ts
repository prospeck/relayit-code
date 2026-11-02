import { GOOGLE_INSTRUCTIONS } from "../../shared/google.ts";
import { gateServer } from "../mcp-gate-config.ts";
import { AGENTS_NODE_FLAG, SPAWNED_PROXIES } from "../proxy-paths.ts";
import type { StdioServer } from "../mcp-gate-config.ts";

export { GOOGLE_INSTRUCTIONS };

/** The built-in gets the same Full-access outbound gate as custom servers, even on engines bypassing approval. */
export function googleMount(token: string, harnessUrl: string, threadId: string, fullAccess: boolean): StdioServer & { args: string[]; env: Record<string, string> } {
  const server = { command: process.execPath, args: [SPAWNED_PROXIES.harnessMcp, "google"], env: { ...AGENTS_NODE_FLAG, OMB_MCP_TOKEN_GOOGLE: token, OMB_HARNESS_URL: harnessUrl } };
  if (!fullAccess) return server;
  const gated = gateServer({ name: "google", server, threadId, budget: 0, nodeEnv: AGENTS_NODE_FLAG, refuseOutbound: true });
  if (!gated) throw new Error("Google requires an outbound gate on Full access.");
  return gated;
}
