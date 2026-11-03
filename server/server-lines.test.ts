import { describe, expect, it } from "vitest";

import "./server-line-packs.ts";
import { serverLine } from "./server-lines.ts";

describe("serverLine", () => {
  it("writes the line in the language given, with its values filled in", () => {
    expect(serverLine("de", "server.teammates.sent", { bot: "Ada" })).toBe("An Ada gesendet");
    expect(serverLine(undefined, "server.teammates.sent", { bot: "Ada" })).toBe("Sent to Ada");
    expect(serverLine("en", "server.mcp.testTools.many", { count: 5 })).toBe("Test: 5 tools");
  });

  it("reads a regional tag as its language, and a language it has no words for as English", () => {
    expect(serverLine("de-AT", "server.notify.done", { who: "Ada" })).toBe("Ada ist fertig");
    expect(serverLine("pt", "server.notify.done", { who: "Ada" })).toBe(serverLine("pt-br", "server.notify.done", { who: "Ada" }));
    expect(serverLine("pt", "server.notify.done", { who: "Ada" })).toBe("Ada terminou");
    expect(serverLine("zh-Hant", "server.notify.done", { who: "Ada" })).toBe(serverLine("zh-tw", "server.notify.done", { who: "Ada" }));
    expect(serverLine("nl", "server.notify.done", { who: "Ada" })).toBe("Ada finished");
  });

  it("leaves a {name} it was given no value for as it is", () => {
    expect(serverLine("en", "server.runs.didNotFinishWhy", {})).toBe("This run didn't finish: {detail}");
  });
});
