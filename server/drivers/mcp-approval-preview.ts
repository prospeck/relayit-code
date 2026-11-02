import type { SendTurnInput } from "../contracts.ts";
import { isShippedIndiaConnector } from "../india-services.ts";
import { mountChatTools } from "./chat-mcp-tools.ts";
import { readableToolArguments } from "../tool-approval-preview.ts";

/** Native CLI permission brokers use a separate read-only preview connection to the shipped connector. */
export async function mcpApprovalSummary(tool: string, input: Record<string, unknown>, integrations: SendTurnInput["integrations"]): Promise<string> {
  const target = Object.entries(integrations?.custom ?? {}).find(([name]) => tool.startsWith(`mcp__${name}__`));
  if (!target || !isShippedIndiaConnector(target[0], target[1])) return readableToolArguments(input);
  const [name, server] = target;
  const action = tool.slice(`mcp__${name}__`.length);
  const session = await mountChatTools({ custom: { [name]: server } }, AbortSignal.timeout(20_000));
  try {
    const projected = `${name}_${action}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    return await session.approvalSummary(projected, input);
  } finally {
    await session.close();
  }
}
