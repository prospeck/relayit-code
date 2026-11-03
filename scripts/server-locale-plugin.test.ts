import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

import { serverLinesOnly, serverLocalePlugin } from "./server-locale-plugin.mjs";

const SERVER_LINES = fileURLToPath(new URL("../server/server-line-packs.ts", import.meta.url));

describe("the server's bundle of the language packs", () => {
  it("keeps only the lines the server writes", () => {
    expect(serverLinesOnly({ "server.notify.done": "Sent", "chat.turnStopped": "Stopped", "serverish.key": "x" })).toEqual({ "server.notify.done": "Sent" });
  });

  it("carries every language's server lines and none of the app's screens", async () => {
    const bundled = await build({ entryPoints: [SERVER_LINES], bundle: true, write: false, platform: "node", format: "esm", plugins: [serverLocalePlugin], logLevel: "silent" });
    const code = bundled.outputFiles[0]!.text;
    expect(code).toContain("{who} ist fertig");
    expect(code).toContain("{who} finished");
    expect(code).not.toContain("notice.openFailed");
    expect(code.length).toBeLessThan(1_000_000);
  });
});
