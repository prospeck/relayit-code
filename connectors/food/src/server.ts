#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FoodProvider } from "./provider.ts";
import { registerTools } from "./tools.ts";

export function createServer(provider: FoodProvider) {
  const server = new McpServer({ name: "relayit-food", version: "0.1.0" });
  registerTools(server, provider);
  return server;
}
