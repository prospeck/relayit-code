import type { App } from "./app.ts";
import type { RouteModule } from "./api/server.ts";

/**
 * Wires connectors (Google, MCP, payments, browser, scheduler…) into the app.
 * Each integration registers its tools, hooks, timers and API routes here.
 */
export async function loadPlugins(_app: App): Promise<RouteModule[]> {
  const modules: RouteModule[] = [];
  return modules;
}
