/** Names RelayIt gives its own MCP servers; a custom server may not take one. */
export const RESERVED_MCP_NAMES: ReadonlySet<string> = new Set([
  "ogb",
  "computer",
  "agents",
  "composio",
  "data",
  "google",
  "browser",
  "phone",
  "dweb",
  "relayit_connectors",
  "relayit_phone",
]);

/** A server name from any text: lowercase letters, numbers, `_` and `-`, starting with a letter, at most 32. */
export function slugMcpName(raw: string): string {
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return /^[a-z]/.test(slug) ? slug : slug ? `mcp-${slug}`.slice(0, 32) : "";
}

/** What RelayIt names a server another tool calls `raw`; a name RelayIt keeps for itself gets an mcp- prefix. */
export function importedMcpServerName(raw: string): string {
  const slug = slugMcpName(raw);
  return RESERVED_MCP_NAMES.has(slug) ? `mcp-${slug}`.slice(0, 32) : slug;
}
