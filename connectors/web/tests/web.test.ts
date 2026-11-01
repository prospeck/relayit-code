import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MessagePart } from "@relayit/shared";
import type { ToolContext } from "@relayit/shared";
import { ExaClient, createWebTools, extractReadable, fetchReadable } from "../src/index.ts";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

let baseUrl: string;
let handle: (request: IncomingMessage, response: ServerResponse) => void;
const server = createServer((request, response) => handle(request, response));
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterEach(() => {
  vi.mocked(lookup).mockReset();
  vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
});

const publicFetch: typeof fetch = (input, init) =>
  fetch(`${baseUrl}${new URL(String(input)).pathname}`, init);
const search = {
  query: "soil care",
  numResults: 3,
  type: "auto" as const,
  contents: { text: { maxCharacters: 50 } },
  startPublishedDate: "2026-01-01",
};

describe("Exa", () => {
  it("posts the request and header to the injected server and normalizes results", async () => {
    let received: { method?: string; path?: string; key?: string; body?: unknown } = {};
    handle = (request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received = {
          method: request.method,
          path: request.url,
          key: request.headers["x-api-key"] as string,
          body: JSON.parse(Buffer.concat(chunks).toString()),
        };
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            results: [
              { title: "Soil", url: "https://example.test/soil", text: "Good soil" },
              {
                url: "https://example.test/rain",
                publishedDate: "2026-02-01",
                text: "x".repeat(100),
              },
            ],
          }),
        );
      });
    };
    const client = new ExaClient({ apiKey: "offline-placeholder", baseUrl, fetch });
    expect(await client.search(search)).toEqual([
      {
        title: "Soil",
        url: "https://example.test/soil",
        publishedDate: null,
        snippet: "Good soil",
      },
      {
        title: "https://example.test/rain",
        url: "https://example.test/rain",
        publishedDate: "2026-02-01",
        snippet: "x".repeat(50),
      },
    ]);
    expect(received).toEqual({
      method: "POST",
      path: "/search",
      key: "offline-placeholder",
      body: search,
    });
    await expect(client.search({ ...search, numResults: 11 })).rejects.toThrow();
  });

  it.each([
    [401, "API key"],
    [429, "rate limited"],
    [500, "temporarily unavailable"],
    [503, "temporarily unavailable"],
    [400, "HTTP 400"],
  ])("maps HTTP %s without echoing upstream content", async (status, message) => {
    handle = (_request, response) => {
      response.writeHead(Number(status));
      response.end("private-upstream-body");
    };
    await expect(
      new ExaClient({ apiKey: "offline-placeholder", baseUrl }).search(search),
    ).rejects.toThrow(String(message));
  });

  it("rejects invalid response shapes", async () => {
    handle = (_request, response) => {
      response.end("{}");
    };
    await expect(
      new ExaClient({ apiKey: "offline-placeholder", baseUrl }).search(search),
    ).rejects.toThrow("invalid search response");
  });
});

describe("readable pages", () => {
  it("prefers article text, removes discarded elements, preserves lines and decodes entities", async () => {
    const html = await readFile(new URL("./fixtures/article.html", import.meta.url), "utf8");
    expect(extractReadable(html)).toEqual({
      title: "Farm & field",
      text: 'Soil & water\nUse water & compost 🌱.\nSteps\nTest soil\nSave "rain" — don\'t waste it.',
    });
    handle = (_request, response) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
    };
    expect(await fetchReadable(baseUrl, { allowPrivate: true, maxChars: 12 })).toEqual({
      url: `${baseUrl}/`,
      title: "Farm & field",
      text: "Soil & water",
      truncated: true,
    });
  });

  it("prefers main when there is no article and falls back to body text", () => {
    expect(
      extractReadable("<nav>Menu</nav>Outside<main><h2>Title</h2><p>Content</p></main>").text,
    ).toBe("Title\nContent");
    expect(extractReadable("<p>Body &#39; &#x26;</p>").text).toBe("Body ' &");
  });

  it("drops nested navigation and ignores HTML-looking strings in scripts", () => {
    expect(
      extractReadable(
        '<nav>Outer<nav>Inner</nav>Still navigation</nav><main><script>const s = "<nav>";</script>Readable</main>',
      ).text,
    ).toBe("Readable");
  });

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.1",
    "169.254.1.1",
    "172.16.0.1",
    "[::1]",
    "[fc00::1]",
    "[fe80::1]",
    "[::ffff:127.0.0.1]",
    "localhost",
    "sub.localhost",
    "localhost.",
    "2130706433",
    "0x7f000001",
  ])("rejects private host %s before fetching", async (host) => {
    const fake = vi.fn<typeof fetch>();
    await expect(fetchReadable(`http://${host}/`, { fetch: fake })).rejects.toThrow(
      "Private or local",
    );
    expect(fake).not.toHaveBeenCalled();
  });

  it("checks every DNS address and rejects a private answer", async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ] as never);
    const fake = vi.fn<typeof fetch>();
    await expect(fetchReadable("https://example.test", { fetch: fake })).rejects.toThrow(
      "Private or local",
    );
    expect(lookup).toHaveBeenCalledWith("example.test", { all: true });
    expect(fake).not.toHaveBeenCalled();
  });

  it("rechecks redirects and refuses a redirect to a private IP", async () => {
    handle = (_request, response) => {
      response.writeHead(302, { location: "http://127.0.0.1/private" });
      response.end();
    };
    await expect(
      fetchReadable("http://example.test/start", { fetch: publicFetch }),
    ).rejects.toThrow("Private or local");
  });

  it("follows at most five relative redirects and reports the final URL", async () => {
    handle = (request, response) => {
      const n = Number(request.url?.slice(1));
      if (n < 5) {
        response.writeHead(302, { location: `/${n + 1}` });
        response.end();
      } else {
        response.setHeader("Content-Type", "text/plain");
        response.end(" Finished ");
      }
    };
    expect(await fetchReadable("http://example.test/0", { fetch: publicFetch })).toEqual({
      url: "http://example.test/5",
      title: "example.test",
      text: "Finished",
      truncated: false,
    });
    handle = (_request, response) => {
      response.writeHead(302, { location: "/loop" });
      response.end();
    };
    await expect(fetchReadable("http://example.test/loop", { fetch: publicFetch })).rejects.toThrow(
      "5 redirects",
    );
  });

  it.each(["application/json", "image/png", "application/octet-stream"])(
    "refuses %s",
    async (type) => {
      handle = (_request, response) => {
        response.setHeader("Content-Type", type);
        response.end("data");
      };
      await expect(fetchReadable(baseUrl, { allowPrivate: true })).rejects.toThrow(
        "Only text/html and text/plain",
      );
    },
  );

  it.each([true, false])("caps downloads with content-length present: %s", async (length) => {
    handle = (_request, response) => {
      response.setHeader("Content-Type", "text/plain");
      if (length) response.setHeader("Content-Length", 2 * 1024 * 1024 + 1);
      response.end("x".repeat(2 * 1024 * 1024 + 1));
    };
    await expect(fetchReadable(baseUrl, { allowPrivate: true })).rejects.toThrow("2 MB");
  });

  it("refuses unsafe schemes even with the private test flag", async () => {
    await expect(fetchReadable("file:///etc/passwd", { allowPrivate: true })).rejects.toThrow(
      "Only http and https",
    );
    await expect(
      fetchReadable("http://user:pass@example.test", { fetch: publicFetch }),
    ).rejects.toThrow("credentials");
  });

  it("times out a slow response body", async () => {
    handle = (_request, response) => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.write("waiting");
    };
    await expect(fetchReadable(baseUrl, { allowPrivate: true, timeoutMs: 40 })).rejects.toThrow();
  });

  it("includes DNS resolution in the timeout", async () => {
    vi.mocked(lookup).mockImplementation(() => new Promise(() => {}) as never);
    await expect(
      fetchReadable("http://example.test", { fetch: publicFetch, timeoutMs: 40 }),
    ).rejects.toThrow();
  });
});

describe("web tools", () => {
  const ctx = {} as ToolContext;
  it("returns a valid sources part capped at eight items", async () => {
    handle = (_request, response) => {
      response.end(
        JSON.stringify({
          results: Array.from({ length: 10 }, (_, i) => ({
            title: `Source ${i}`,
            url: `https://example.test/${i}`,
            text: "Snippet",
          })),
        }),
      );
    };
    const tool = createWebTools({
      getExaKey: async () => "offline-placeholder",
      baseUrl,
      fetch,
    })[0]!;
    expect(tool).toMatchObject({
      name: "web_search",
      domain: "web",
      service: "Web",
      toolClass: "read",
      untrustedOutput: true,
    });
    const input = tool.input.parse({ query: "soil", numResults: 10 });
    const output = await tool.run(input, ctx);
    const parts = tool.toParts!(output, input);
    expect(parts).toHaveLength(1);
    expect(MessagePart.parse(parts[0])).toEqual({
      type: "sources",
      sources: output
        .slice(0, 8)
        .map(({ title, url }: { title: string; url: string }) => ({ title, url })),
    });
  });

  it("gives a Settings instruction without calling the network when no key is configured", async () => {
    const fake = vi.fn<typeof fetch>();
    const tool = createWebTools({ getExaKey: async () => null, fetch: fake })[0]!;
    await expect(tool.run({ query: "soil" }, ctx)).rejects.toThrow(
      "Add an Exa key in Settings → Connections",
    );
    expect(fake).not.toHaveBeenCalled();
  });

  it("returns readable text and a valid link part", async () => {
    handle = (_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end(`<title>Soil</title><main>${"x".repeat(13_000)}</main>`);
    };
    const tool = createWebTools({ getExaKey: async () => null, fetch: publicFetch })[1]!;
    const input = tool.input.parse({ url: "http://example.test/page" });
    const page = await tool.run(input, ctx);
    expect(page.text).toHaveLength(12_000);
    expect(page.truncated).toBe(true);
    expect(MessagePart.parse(tool.toParts!(page, input)[0])).toEqual({
      type: "link",
      url: input.url,
      title: "Soil",
    });
    expect(tool).toMatchObject({ toolClass: "read", untrustedOutput: true });
  });
});
