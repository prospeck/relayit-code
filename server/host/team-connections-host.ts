// Direct connections use only this installation's own credentials.
import type * as Composio from "../composio.ts";
import type { AppConfig } from "../config.ts";
import type { McpServerSpec } from "../contracts.ts";
import { withMcpSignIn, withoutPendingSignIn, type McpOAuthManager } from "../mcp-oauth.ts";
import { PeopleConnections, ConnectionScopes, SCOPES_FILE } from "../team-connections.ts";
import { join } from "node:path";
import { APP_TOOL_NAMES_ENV, APP_TOOLS_ENV, appToolsFor } from "../connector-app-tools.ts";
import type { ConnectorScopes } from "../../shared/connector-scopes.ts";
type Bot = { id: string; name: string; connectorTools?: Parameters<typeof Composio.mcpIntegration>[1]["connectorTools"]; connectorScopes?: ConnectorScopes };
type McpBot = { id: string; name: string; mcpServers?: string[] };
type Integration = { command: string; args: string[]; env: Record<string, string> };
export interface TeamConnectionsHostDeps { dataDir: string; cfg(): AppConfig; harnessUrl: string; mint(capability: { botId: string; threadId: string; generation: string }): string; mcpOAuth: McpOAuthManager; botMcp(bot: McpBot): Record<string, McpServerSpec>; composio: Pick<typeof Composio, "configured" | "mcpIntegration" | "connectedServices">; isOwnerLive(owner: string): boolean; }
const APPS_FRESH_MS=60_000, APPS_RETRY_MS=10_000, FIRST_APPS_WAIT_MS=3_000;
export function createTeamConnectionsHost(deps: TeamConnectionsHostDeps) {
 const people = new PeopleConnections({ dataDir: deps.dataDir, isOwnerLive: deps.isOwnerLive, clients: () => undefined });
 const scopes = new ConnectionScopes(join(deps.dataDir, SCOPES_FILE));
  const connectedApps = new Map<string, { at: number; apps: string[] | null; reading: Promise<void> | null }>();
  const appsConnected = async (): Promise<string[]> => {
    const key = "";
    const entry = connectedApps.get(key) ?? { at: -Infinity, apps: null, reading: null };
    connectedApps.set(key, entry);
    if (!entry.reading && Date.now() - entry.at >= (entry.apps ? APPS_FRESH_MS : APPS_RETRY_MS)) {
      entry.reading = deps.composio.connectedServices(deps.cfg()).then((services) => {
        entry.apps = Object.entries(services).filter(([, state]) => state.connected).map(([slug]) => slug);
      }, () => {}).finally(() => { entry.at = Date.now(); entry.reading = null; });
    }
    if (!entry.apps && entry.reading) {
      await Promise.race([entry.reading, new Promise<void>((resolve) => { setTimeout(resolve, FIRST_APPS_WAIT_MS).unref?.(); })]);
    }
    return entry.apps ?? [];
  };
  const withAppTools = async (bridge: Integration, bot: Bot, names: "dotted" | "plain"): Promise<Integration> => {
    const tools = appToolsFor(bot, await appsConnected());
    return tools.length ? { ...bridge, env: { ...bridge.env, [APP_TOOLS_ENV]: JSON.stringify(tools), [APP_TOOL_NAMES_ENV]: names } } : bridge;
  };

 return { people, scopes, personMcp: (): string[] => [],
 primeApps() { if(deps.composio.configured(deps.cfg())) void appsConnected(); },
 async appsIntegrations(bot: Bot, threadId: string, generation: string, names: "dotted" | "plain" = "plain"): Promise<{composio?: Integration}> { const bridge = await deps.composio.mcpIntegration(deps.cfg(), { harnessUrl: deps.harnessUrl, botId: bot.id, threadId, connectorTools: bot.connectorTools, commsToken: deps.mint({ botId: bot.id, threadId, generation }) }); return bridge ? { composio: await withAppTools(bridge, bot, names) } : {}; },
 turnMcp: async (bot: McpBot, _threadId: string, _generation: string) => withMcpSignIn(deps.botMcp(bot), deps.mcpOAuth),
 engineMcp: (bot: McpBot) => withoutPendingSignIn(deps.botMcp(bot), deps.mcpOAuth),
 forgetServer(name: string) { people.forgetServer(name); },
 mcpCallback: (host: string | undefined, search: string) => deps.mcpOAuth.publicCallback(host, search),
 };
}
export type TeamConnectionsHost = ReturnType<typeof createTeamConnectionsHost>;
