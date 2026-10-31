#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockFoodProvider } from "./mock/provider.ts";
import type { FoodProvider } from "./provider.ts";
import { registerTools } from "./tools.ts";

export function createServer(provider: FoodProvider) {
  const server = new McpServer({ name: "relayit-food", version: "0.1.0" });
  registerTools(server, provider);
  return server;
}
if (import.meta.main) {
  const server = createServer(
    new MockFoodProvider(process.env.RELAYIT_DATA_DIR ?? join(tmpdir(), "relayit-food")),
  );
  await server.connect(new StdioServerTransport());
}
