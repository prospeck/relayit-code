#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { TravelProvider } from "./provider.ts";
import { MockTravelProvider } from "./mock/provider.ts";
import { registerTools } from "./tools.ts";

export function createServer(provider: TravelProvider = new MockTravelProvider()) {
  const server = new McpServer({ name: "relayit-travel", version: "0.1.0" });
  registerTools(server, provider);
  return server;
}
if (import.meta.main) await createServer().connect(new StdioServerTransport());
