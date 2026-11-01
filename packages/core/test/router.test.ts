import { describe, expect, it } from "vitest";
import { routeDomains } from "../src/agent/router.ts";
import { ScriptedModel, text } from "./helpers/scriptedModel.ts";

const available = ["general", "food", "payments", "browser", "email", "calendar", "travel"];
const route = (input: string) => routeDomains({ text: input, available, totalTools: 30 });

describe("domain routing", () => {
  it("includes food companions", async () =>
    expect(await route("I'm hungry, order pizza")).toEqual(["food", "payments", "browser"]));
  it("includes calendar with email", async () =>
    expect(await route("Read my email")).toEqual(["email", "calendar"]));
  it("returns all for a small tool set without invoking the router", async () => {
    const provider = new ScriptedModel();
    expect(
      await routeDomains({
        text: "pizza",
        available,
        totalTools: 24,
        provider,
        routerModel: "cheap",
      }),
    ).toBe("all");
    expect(provider.requests).toHaveLength(0);
  });
  it("uses JSON routing, filters unavailable domains and adds companions", async () => {
    const provider = new ScriptedModel(
      text('```json\n{"domains":["food","not-real",3,"food"]}\n```'),
    );
    expect(
      await routeDomains({
        text: "help",
        available,
        totalTools: 30,
        provider,
        routerModel: "cheap",
      }),
    ).toEqual(["food", "payments", "browser"]);
    expect(provider.requests[0]).toMatchObject({
      model: "cheap",
      json: true,
      temperature: 0,
      maxTokens: 100,
      messages: [{ role: "user", content: "help" }],
    });
    expect(provider.requests[0]!.system).toContain(available.join(", "));
  });
  it.each(["error", "malformed"])("falls back to heuristics on %s", async (mode) => {
    const provider =
      mode === "error"
        ? new ScriptedModel(async function* () {
            yield* [];
            throw new Error("router failed");
          })
        : new ScriptedModel(text("invalid JSON"));
    expect(
      await routeDomains({
        text: "read email",
        available,
        totalTools: 30,
        provider,
        routerModel: "cheap",
      }),
    ).toEqual(["email", "calendar"]);
  });
});
