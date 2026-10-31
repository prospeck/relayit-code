import { z } from "zod";

const searchInput = z.object({
  query: z.string().trim().min(1),
  numResults: z.number().int().min(1).max(10),
  type: z.literal("auto"),
  contents: z.object({ text: z.object({ maxCharacters: z.number().int().positive() }) }),
  startPublishedDate: z.string().optional(),
});
const searchResponse = z.object({ results: z.array(z.object({
  title: z.string().nullish(),
  url: z.url({ protocol: /^https?$/ }),
  publishedDate: z.string().nullish(),
  text: z.string().nullish(),
})) });

export type ExaSearchInput = z.infer<typeof searchInput>;
export type ExaResult = { title: string; url: string; publishedDate: string | null; snippet: string };

export class ExaClient {
  #apiKey: string;
  #baseUrl: string;
  #fetch: typeof globalThis.fetch;

  constructor({ apiKey, baseUrl = "https://api.exa.ai", fetch = globalThis.fetch }: {
    apiKey: string; baseUrl?: string; fetch?: typeof globalThis.fetch;
  }) {
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#fetch = fetch;
  }

  async search(input: ExaSearchInput): Promise<ExaResult[]> {
    const validated = searchInput.parse(input);
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": this.#apiKey },
        body: JSON.stringify(validated),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
    } catch {
      throw new Error("Could not reach Exa search. Please try again.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) throw new Error("Exa rejected the API key. Update it in Settings → Connections.");
      if (response.status === 429) throw new Error("Exa search is rate limited. Please try again shortly.");
      if (response.status >= 500) throw new Error("Exa search is temporarily unavailable. Please try again later.");
      throw new Error(`Exa search failed (HTTP ${response.status}).`);
    }
    const parsed = searchResponse.safeParse(await response.json());
    if (!parsed.success) throw new Error("Exa returned an invalid search response.");
    return parsed.data.results.slice(0, validated.numResults).map((result) => ({
      title: result.title || result.url,
      url: result.url,
      publishedDate: result.publishedDate ?? null,
      snippet: (result.text ?? "").slice(0, validated.contents.text.maxCharacters),
    }));
  }
}
