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

  // Tell the model which services are wired up, so it picks the official route first.
  app.addSystemExtra(async () => {
    const byDomain = new Map<string, Set<string>>();
    for (const t of app.registry.list()) {
      if (t.internal || t.def.domain === "general" || t.def.domain === "demo") continue;
      if (!byDomain.has(t.def.domain)) byDomain.set(t.def.domain, new Set());
      byDomain.get(t.def.domain)!.add(t.def.service);
    }
    const lines = [...byDomain.entries()].map(([d, s]) => `- ${d}: ${[...s].join(", ")}`).join("\n");
    return `# Connected services\n${lines || "- none yet"}\nPrefer an official connection (e.g. Swiggy, Zomato) for a service when one is connected. Use the browser agent only when no connection can do it, and tell the user you're using their browser session. If the user names a service that isn't connected and the browser agent is off, say how to connect it in Connections. The "RelayIt Food (demo)" restaurants are sample data — say so if the user seems to expect a real order.`;
  });

  return [mcpRoutes(mcp), googleRoutes(google), payments.routes(), proactive.routes()];
}
