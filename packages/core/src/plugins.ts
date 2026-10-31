import type { App } from "./app.ts";
import type { RouteModule } from "./api/server.ts";
import { McpManager, mcpRoutes } from "./integrations/mcp.ts";
import { GoogleIntegration, googleRoutes } from "./integrations/google.ts";
import { PaymentsIntegration } from "./integrations/payments.ts";
import { Proactive } from "./integrations/proactive.ts";
import { trackTasks } from "./integrations/tasks.ts";

/**
 * Wires connectors (Google, MCP, payments, browser, scheduler…) into the app.
 * Each integration registers its tools, hooks, timers and API routes here.
 */
export async function loadPlugins(app: App): Promise<RouteModule[]> {
  const mcp = new McpManager(app);
  const google = new GoogleIntegration(app);
  const payments = new PaymentsIntegration(app, mcp);
  const proactive = new Proactive(app, google, mcp);

  trackTasks(app);
  await google.start();
  await payments.start();
  await proactive.start();
  // MCP servers connect in the background so a slow remote server never blocks startup.
  void mcp.start().catch((e) => console.error("[mcp]", e));
  app.onShutdown(() => mcp.stop());

  return [mcpRoutes(mcp), googleRoutes(google), payments.routes(), proactive.routes()];
}
