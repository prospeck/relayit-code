// The desktop app's private parent port, for a server a test or the launcher's desktop mode starts as if Electron had:
// the server runs as Electron's utility process, and only what the app itself would send crosses.
// OMB_TEST_DESKTOP_OWNER_TOKEN (with OMB_DESKTOP_PARENT=1): the test's owner capability.
// OMB_TEST_DESKTOP_CUA_CONNECTION: a file holding the app's driver record; the app hands it to its own server, and again
// each time the file changes, as the real app does each time its driver changes.
import { createHash } from "node:crypto";
import { readFileSync, unwatchFile, watchFile } from "node:fs";

const token = process.env.OMB_TEST_DESKTOP_OWNER_TOKEN;
const cuaFile = process.env.OMB_TEST_DESKTOP_CUA_CONNECTION;
delete process.env.OMB_TEST_DESKTOP_OWNER_TOKEN;
delete process.env.OMB_TEST_DESKTOP_CUA_CONNECTION;

const cuaGrant = () => {
  let connection = null;
  try {
    connection = JSON.parse(readFileSync(cuaFile, "utf8"));
  } catch {}
  return { type: "relayit:local-computer", connection };
};

if (token || cuaFile) {
  const listeners = [];
  if (cuaFile) {
    watchFile(cuaFile, { interval: 25, persistent: false }, () => {
      const grant = cuaGrant();
      for (const listener of listeners) listener({ data: grant });
    });
    process.once("exit", () => unwatchFile(cuaFile));
  }
  Object.defineProperty(process, "parentPort", {
    value: {
      on(event, listener) {
        if (event !== "message") return;
        listeners.push(listener);
        if (token) queueMicrotask(() => listener({ data: { type: "relayit:desktop-mutation-token", token } }));
        if (cuaFile) queueMicrotask(() => listener({ data: cuaGrant() }));
      },
      removeListener(event, listener) {
        const at = listeners.indexOf(listener);
        if (event === "message" && at >= 0) listeners.splice(at, 1);
      },
      // The server asks its parent for the credential master key before it starts (server/credential-store.ts): answer as the
      // app does, with a key that is the same on every start of the same data dir.
      postMessage(message) {
        if (message?.type !== "relayit:credential-master-request") return;
        const key = createHash("sha256").update(`fixture-credential-master:${process.env.OMB_DATA_DIR}`).digest("hex");
        queueMicrotask(() => { for (const listener of [...listeners]) listener({ data: { type: "relayit:credential-master", dataDir: process.env.OMB_DATA_DIR, master: { key, protection: "key-file" } } }); });
      },
    },
  });
}
