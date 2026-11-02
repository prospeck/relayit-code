// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestPanelPage, usePanelPage, type PanelPage } from "./page-open";

const PAGE = "https://abcdefghijklmnopqrstuvwxyz.pages.example.test/";


describe("the panel's page requests", () => {
  const roots: Array<{ unmount(): void }> = [];
  afterEach(() => { for (const root of roots.splice(0)) root.unmount(); vi.useRealTimers(); });
  function panel(botId: string) {
    const got: PanelPage[] = [];
    const container = document.createElement("div"), root = createRoot(container);
    roots.push(root);
    function Panel() { usePanelPage(botId, (page) => got.push(page)); return null; }
    flushSync(() => root.render(createElement(Panel)));
    return got;
  }

  it("go once to the bot's panel, open now or opening next, and never to another bot's", () => {
    const pepper = panel("pepper"), salt = panel("salt");
    requestPanelPage("pepper", PAGE);
    expect(pepper.map((page) => page.url)).toEqual([PAGE]);
    expect(salt).toEqual([]);
    requestPanelPage("basil", PAGE);
    expect(panel("basil").map((page) => page.url)).toEqual([PAGE]);
    expect(panel("basil")).toEqual([]);
  });

  it("are dropped once stale, so a panel opened much later opens nothing by itself", () => {
    requestPanelPage("thyme", PAGE, Date.now() - 60_000);
    expect(panel("thyme")).toEqual([]);
  });
});
