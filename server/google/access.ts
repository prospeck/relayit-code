import type { BotRecord } from "../store.ts";
import { allowsTool } from "../../shared/tool-scope.ts";
import type { ToolDef } from "../../connectors/google/src/contract.ts";

export type GoogleBot = Pick<BotRecord, "composio" | "toolScope" | "connectorScopes" | "connectorTools">;

export function googleToolAllowed(bot: GoogleBot, tool: Pick<ToolDef, "name" | "toolClass">, args?: unknown): boolean {
  if (bot.composio === false || !allowsTool(bot.toolScope, { kind: "mcp", server: "google", name: tool.name }, args)) return false;
  const app = tool.name.startsWith("gmail_") ? "gmail" : "googlecalendar";
  if (bot.connectorScopes) {
    const scope = bot.connectorScopes.apps[app];
    if (!scope || (scope === "read" && tool.toolClass !== "read")) return false;
  }
  const grant = bot.connectorTools?.[app];
  return bot.connectorTools === undefined || !!grant && (grant.tools === "*" || grant.tools.includes(tool.name));
}
