import { defineTool } from "@relayit/shared";
import type { ToolContext, ToolDef } from "@relayit/shared";
import { z } from "zod";
import { ExaClient } from "./exa.ts";
import { fetchReadable } from "./fetchPage.ts";

export function createWebTools({
  getExaKey,
  fetch,
  baseUrl,
}: {
  getExaKey: (ctx: ToolContext) => Promise<string | null>;
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}): ToolDef[] {
  return [
    defineTool({
      name: "web_search",
      description: "Search the web for current information and sources.",
      domain: "web",
      service: "Web",
      toolClass: "read",
      untrustedOutput: true,
      input: z.object({
        query: z.string().trim().min(1),
        numResults: z.number().int().min(1).max(10).optional(),
      }),
      label: () => "Searching the web",
      async run(input, ctx) {
        const apiKey = await getExaKey(ctx);
        if (!apiKey?.trim())
          throw new Error("Add an Exa key in Settings → Connections to search the web.");
        return new ExaClient({ apiKey, fetch, baseUrl }).search({
          query: input.query,
          numResults: input.numResults ?? 5,
          type: "auto",
          contents: { text: { maxCharacters: 2000 } },
        });
      },
      toParts: (results) => [
        { type: "sources", sources: results.slice(0, 8).map(({ title, url }) => ({ title, url })) },
      ],
    }),
    defineTool({
      name: "web_read_page",
      description: "Read the text of a public web page, up to 12,000 characters.",
      domain: "web",
      service: "Web",
      toolClass: "read",
      untrustedOutput: true,
      input: z.object({ url: z.url({ protocol: /^https?$/ }) }),
      label: () => "Reading web page",
      async run(input) {
        return fetchReadable(input.url, { fetch });
      },
      toParts: (page) => [{ type: "link", url: page.url, title: page.title }],
    }),
  ];
}
