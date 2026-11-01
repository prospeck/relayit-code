#!/usr/bin/env node
import { join } from "node:path";
import { homedir } from "node:os";
import { App } from "./app.ts";
import { startServer } from "./api/server.ts";
import { DevFileKeyProvider, StdinKeyProvider, type KeyProvider } from "./crypto/keyProvider.ts";
import { newToken } from "./util/ids.ts";
import { loadPlugins } from "./plugins.ts";

/**
 * Sidecar entry point.
 *   Desktop:  relayit-core --data-dir <app data> --key-from-stdin
 *   Dev:      node src/main.ts --dev   (fixed port 47821, token from RELAYIT_DEV_TOKEN or "dev", key file in ./.relayit-dev)
 * Prints one line `RELAYIT_READY {"port":…,"token":…}` on stdout when ready.
 */
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const dev = flag("dev");
const keyFromStdin = flag("key-from-stdin");
// Capture EOF even during startup. Windows has no catchable SIGTERM; the shell closes this pipe.
const stdinClosed = keyFromStdin
  ? new Promise<void>((resolve) => {
      process.stdin.once("end", resolve);
      process.stdin.once("close", resolve);
    })
  : null;
const dataDir =
  opt("data-dir") ??
  process.env.RELAYIT_DATA_DIR ??
  (dev ? join(process.cwd(), "../../.relayit-dev") : join(homedir(), ".relayit"));
const keyProvider: KeyProvider = keyFromStdin
  ? new StdinKeyProvider()
  : new DevFileKeyProvider(join(dataDir, "dev-master.key"));
const token = dev ? (process.env.RELAYIT_DEV_TOKEN ?? "dev") : newToken();
const port = Number(opt("port") ?? (dev ? 47821 : 0));

const app = new App({
  dataDir,
  keyProvider,
  mockModel: process.env.RELAYIT_MOCK_MODEL === "1",
  fakeGoogleUrl:
    process.env.RELAYIT_FAKE_GOOGLE === "1"
      ? "auto"
      : (process.env.RELAYIT_FAKE_GOOGLE_URL ?? null),
});

await app.start();
const modules = await loadPlugins(app);
const server = await startServer(app, { port, token, modules });
process.stdout.write(
  `RELAYIT_READY ${JSON.stringify({ port: server.port, token: dev ? token : token })}\n`,
);
if (dev)
  console.error(`[relayit] core listening on http://127.0.0.1:${server.port} (data: ${dataDir})`);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await server.close().catch(() => {});
  await app.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
if (process.platform !== "win32") process.on("SIGTERM", shutdown);
// The desktop shell closes our stdin when it exits; follow it.
if (stdinClosed) {
  void stdinClosed.then(shutdown);
  process.stdin.resume();
}
