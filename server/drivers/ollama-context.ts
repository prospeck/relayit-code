// Ollama's /v1 endpoint ignores a requested context size, and its default of 4,096 tokens is smaller than a bot's
// prompt, so the prompt is silently cut and the model can't see its tools. A context size set on the model itself is
// honoured, so RelayIt keeps a small copy of the model with a larger window. The copy shares the original's weights.
const CONTEXT_TOKENS = 8192;
const SETUP_MS = 30_000;
const VERSION_MS = 2_000;
const RETRY_AFTER_MS = 60_000;

const prepared = new Map<string, string>();
/** Servers that answered and aren't Ollama. */
const notOllama = new Set<string>();
/** When setup may next be tried for a model it failed on. A turn makes many requests, and each mustn't wait out the failure again. */
const retryAt = new Map<string, number>();

const copyName = (model: string) => `relayit-${model.replace(/[^\w.-]+/g, "-")}:8k`;

/** Our own copies stay out of the model picker: the person picked the original. */
export const isOllamaContextCopy = (model: string) => /^relayit-.*:8k$/.test(model);

function ollamaOrigin(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return null;
  }
}

const within = (ms: number, signal?: AbortSignal) => {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
};

async function post(url: string, body: unknown, fetcher: typeof fetch, signal?: AbortSignal): Promise<Response> {
  return fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: within(SETUP_MS, signal),
  });
}

/** Local servers can answer every address with a 200, so only Ollama's own version answer counts. */
async function isOllama(origin: string, fetcher: typeof fetch, signal?: AbortSignal): Promise<boolean> {
  const response = await fetcher(`${origin}/api/version`, { redirect: "error", signal: within(VERSION_MS, signal) });
  const body = response.ok ? await response.json().catch(() => null) as { version?: unknown } | null : null;
  return typeof body?.version === "string" && /^\d/.test(body.version);
}

/** The name to send for `model`: its larger-window copy on Ollama, and `model` itself anywhere else or on any failure. */
export async function ollamaModelFor(baseUrl: string, model: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<string> {
  const origin = ollamaOrigin(baseUrl);
  if (!origin || isOllamaContextCopy(model) || notOllama.has(origin)) return model;
  const key = `${origin} ${model}`;
  const known = prepared.get(key);
  if (known) return known;
  if (Date.now() < (retryAt.get(key) ?? 0)) return model;
  const failed = () => {
    retryAt.set(key, Date.now() + RETRY_AFTER_MS);
    return model;
  };
  try {
    if (!await isOllama(origin, fetcher, signal)) {
      notOllama.add(origin);
      return model;
    }
    const shown = await post(`${origin}/api/show`, { model }, fetcher, signal);
    if (!shown.ok) return failed();
    const { parameters } = (await shown.json()) as { parameters?: unknown };
    const own = typeof parameters === "string" ? /^num_ctx\s+(\d+)/m.exec(parameters)?.[1] : undefined;
    if (own && Number(own) >= CONTEXT_TOKENS) {
      prepared.set(key, model);
      return model;
    }
    const name = copyName(model);
    const created = await post(`${origin}/api/create`, { model: name, from: model, parameters: { num_ctx: CONTEXT_TOKENS }, stream: false }, fetcher, signal);
    if (!created.ok) return failed();
    prepared.set(key, name);
    retryAt.delete(key);
    return name;
  } catch {
    // A stopped turn says nothing about the server.
    return signal?.aborted ? model : failed();
  }
}

export function forgetOllamaCopies(): void {
  prepared.clear();
  notOllama.clear();
  retryAt.clear();
}
