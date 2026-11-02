import { expect, it } from "vitest";

import { takeConnectRequest } from "./connect-link";

it("a bot's connect link opens the page that connects it and leaves the address clean", () => {
  expect(takeConnectRequest("https://omb-u-1.server.example.test/?connect=mcp%3Alinear&x=1#top")).toEqual({ rest: "/?x=1#top", surface: "mcp" });
  expect(takeConnectRequest("https://omb-u-1.server.example.test/?connect=highlevel")).toEqual({ rest: "/", surface: "apps" });
  expect(takeConnectRequest("https://omb-u-1.server.example.test/?connect=javascript:alert(1)")).toEqual({ rest: "/", surface: "apps" });
  expect(takeConnectRequest("https://omb-u-1.server.example.test/?x=1")).toBeNull();
});

it("a Team admin link from the Admin opens a Team Cloud's apps, MCP servers, keys or engines", () => {
  expect(takeConnectRequest("https://omb-t-1.server.example.test/?connect=apps")).toEqual({ rest: "/", surface: "apps" });
  expect(takeConnectRequest("https://omb-t-1.server.example.test/?connect=mcp")).toEqual({ rest: "/", surface: "mcp" });
  expect(takeConnectRequest("https://omb-t-1.server.example.test/?connect=keys")).toEqual({ rest: "/", section: "connections" });
  expect(takeConnectRequest("https://omb-t-1.server.example.test/?connect=ai")).toEqual({ rest: "/", section: "engines" });
  expect(takeConnectRequest("https://omb-t-1.server.example.test/?connect=mcp%3ABad%20Name")).toEqual({ rest: "/", surface: "apps" });
});
