import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryPaymentStore, PaymentService, type Payment } from "./service.ts";
import { registerTools } from "./tools.ts";

export function createServer(service = new PaymentService({ store: new InMemoryPaymentStore() }), settled?: (payment: Payment) => Promise<void>) {
  const server = new McpServer({ name: "relayit-payments", version: "0.1.0" });
  registerTools(server, service, settled);
  return server;
}
