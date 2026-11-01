import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { onTestFinished } from "vitest";
import { App, type AppOptions } from "../../src/app.ts";
import { StaticKeyProvider } from "../../src/crypto/keyProvider.ts";
import type { ModelProvider } from "../../src/models/types.ts";

export async function startApp(
  provider: ModelProvider,
  options: Partial<AppOptions> = {},
): Promise<App> {
  const app = new App({
    dataDir: ":memory:",
    keyProvider: new StaticKeyProvider(randomBytes(32)),
    providerOverride: provider,
    timeZone: "Asia/Kolkata",
    ...options,
  });
  await app.start();
  onTestFinished(() => app.stop());
  return app;
}

export async function until<T>(
  get: () => T | Promise<T>,
  accept: (value: T) => boolean,
  timeout = 2000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await get();
    if (accept(value)) return value;
    if (Date.now() >= deadline) throw new Error("Timed out waiting for test condition");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

export async function settled(app: App, conversationId: string, runId: string) {
  return until(
    async () =>
      app.db.selectFrom("agent_runs").selectAll().where("id", "=", runId).executeTakeFirstOrThrow(),
    (run) => ["done", "error"].includes(run.status) && !app.agent.isBusy(conversationId),
  );
}

export async function assistantText(app: App, conversationId: string): Promise<string> {
  return (await app.chat.listMessages(conversationId))
    .filter((m) => m.role === "assistant")
    .flatMap((m) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])))
    .join("\n");
}

export async function localServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export const modelListServer = () =>
  localServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "test-chat" }] }));
  });
