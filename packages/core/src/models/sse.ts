/** Minimal Server-Sent Events reader for fetch responses. Yields `data:` payloads (joined per event). */
export async function* readSse(res: Response, signal?: AbortSignal): AsyncGenerator<{ event: string | null; data: string }> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "");
        let event: string | null = null;
        const data: string[] = [];
        for (const line of chunk.split(/\r?\n/)) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (data.length) yield { event, data: data.join("\n") };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function errorFromResponse(res: Response, provider: string): Promise<{ message: string; retryable: boolean }> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { message?: string } | string; message?: string };
    detail = typeof body.error === "string" ? body.error : body.error?.message ?? body.message ?? "";
  } catch {
    detail = await res.text().catch(() => "");
  }
  const friendly: Record<number, string> = {
    401: "The API key was rejected. Check it in Settings → Model.",
    403: "This key doesn't have access to that model.",
    404: "That model wasn't found for this provider.",
    429: "The provider is rate-limiting requests. Try again in a moment.",
  };
  const base = friendly[res.status] ?? `${provider} returned ${res.status}`;
  return { message: detail ? `${base} (${detail.slice(0, 300)})` : base, retryable: res.status === 429 || res.status >= 500 };
}
