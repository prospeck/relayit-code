import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { probeLocalInjects } from "./local-inject.ts";
import { forgetOllamaCopies, isOllamaContextCopy, ollamaModelFor } from "./ollama-context.ts";

type Reply = { status?: number; body?: unknown } | Error;

function server(replies: Record<string, Reply>) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path !== "/api/version") calls.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const reply = replies[path] ?? (path === "/api/version" ? { body: { version: "0.40.13" } } : { status: 404 });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("ollamaModelFor", () => {
  beforeEach(forgetOllamaCopies);
  afterEach(() => vi.useRealTimers());
  const aMinuteLater = () => vi.setSystemTime(Date.now() + 61_000);

  it("makes a larger-window copy once and sends its name", async () => {
    const { calls, fetcher } = server({ "/api/show": { body: { parameters: "temperature 0.7" } }, "/api/create": {} });
    const url = "http://127.0.0.1:11434/v1";
    expect(await ollamaModelFor(url, "qwen3:4b-instruct", fetcher)).toBe("relayit-qwen3-4b-instruct:8k");
    expect(await ollamaModelFor(url, "qwen3:4b-instruct", fetcher)).toBe("relayit-qwen3-4b-instruct:8k");
    expect(calls.map((call) => call.path)).toEqual(["/api/show", "/api/create"]);
    expect(calls[1]!.body).toEqual({
      model: "relayit-qwen3-4b-instruct:8k",
      from: "qwen3:4b-instruct",
      parameters: { num_ctx: 8192 },
      stream: false,
    });
  });

  it("uses a model as it is when its own window is already big enough", async () => {
    const { calls, fetcher } = server({ "/api/show": { body: { parameters: "num_ctx 32768\nstop x" } } });
    expect(await ollamaModelFor("http://127.0.0.1:11434/v1", "big:latest", fetcher)).toBe("big:latest");
    expect(calls).toHaveLength(1);
  });

  it("copies a model whose own window is too small", async () => {
    const { fetcher } = server({ "/api/show": { body: { parameters: "num_ctx 2048" } }, "/api/create": {} });
    expect(await ollamaModelFor("http://127.0.0.1:11434/v1", "small:latest", fetcher)).toBe("relayit-small-latest:8k");
  });

  it("leaves other local servers alone, even one that answers every address", async () => {
    const lmStudio = server({ "/api/version": { status: 404 } });
    expect(await ollamaModelFor("http://127.0.0.1:1234/v1", "local-model", lmStudio.fetcher)).toBe("local-model");
    const yesToAll = server({ "/api/version": { body: { choices: [] } }, "/api/show": {}, "/api/create": {} });
    expect(await ollamaModelFor("http://127.0.0.1:1235/v1", "local-model", yesToAll.fetcher)).toBe("local-model");
    expect([...lmStudio.calls, ...yesToAll.calls]).toEqual([]);
  });

  it("remembers a server that isn't Ollama, and waits a minute on one that didn't answer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const other = server({ "/api/version": { status: 404 } });
    await ollamaModelFor("http://127.0.0.1:1236/v1", "m", other.fetcher);
    const later = server({ "/api/show": { body: {} }, "/api/create": {} });
    expect(await ollamaModelFor("http://127.0.0.1:1236/v1", "m", later.fetcher)).toBe("m");

    const down = server({ "/api/version": new Error("connection refused") });
    expect(await ollamaModelFor("http://127.0.0.1:1237/v1", "m", down.fetcher)).toBe("m");
    expect(await ollamaModelFor("http://127.0.0.1:1237/v1", "m", later.fetcher)).toBe("m");
    expect(later.calls).toEqual([]);
    aMinuteLater();
    expect(await ollamaModelFor("http://127.0.0.1:1237/v1", "m", later.fetcher)).toBe("relayit-m:8k");
  });

  it("stops setting up when the turn is stopped", async () => {
    const stop = new AbortController();
    stop.abort();
    const fetcher = (async (_url: string | URL, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return new Response("{}");
    }) as typeof fetch;
    expect(await ollamaModelFor("http://127.0.0.1:1238/v1", "m", fetcher, stop.signal)).toBe("m");
    const fine = server({ "/api/show": { body: {} }, "/api/create": {} });
    expect(await ollamaModelFor("http://127.0.0.1:1238/v1", "m", fine.fetcher)).toBe("relayit-m:8k");
  });

  it("falls back to the original on any failure, and tries again a minute later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const down = server({ "/api/show": new Error("connection refused") });
    expect(await ollamaModelFor("http://127.0.0.1:11434/v1", "a:latest", down.fetcher)).toBe("a:latest");
    aMinuteLater();
    const refused = server({ "/api/show": { body: {} }, "/api/create": { status: 500 } });
    expect(await ollamaModelFor("http://127.0.0.1:11434/v1", "a:latest", refused.fetcher)).toBe("a:latest");
    aMinuteLater();
    const fine = server({ "/api/show": { body: {} }, "/api/create": {} });
    expect(await ollamaModelFor("http://127.0.0.1:11434/v1", "a:latest", fine.fetcher)).toBe("relayit-a-latest:8k");
  });

  it("never copies a copy, and knows its own", async () => {
    const { calls, fetcher } = server({});
    expect(await ollamaModelFor("http://127.0.0.1:11434/v1", "relayit-a-latest:8k", fetcher)).toBe("relayit-a-latest:8k");
    expect(calls).toHaveLength(0);
    expect(isOllamaContextCopy("relayit-a-latest:8k")).toBe(true);
    expect(isOllamaContextCopy("qwen3:4b-instruct")).toBe(false);
  });
});

describe("the local model picker", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists the model the person picked, not our copy of it", async () => {
    vi.stubGlobal("fetch", (async (url: string | URL) => {
      if (!String(url).includes(":11434")) throw new Error("offline");
      return new Response(String(url).endsWith("/models")
        ? JSON.stringify({ data: [{ id: "relayit-qwen3-4b-instruct:8k" }, { id: "qwen3:4b-instruct" }] })
        : JSON.stringify({ models: [{ name: "relayit-qwen3-4b-instruct:8k", context_length: 8192 }] }));
    }) as typeof fetch);
    const models = await probeLocalInjects({});
    expect(models.filter((model) => model.host === "ollama").map((model) => model.model)).toEqual(["qwen3:4b-instruct"]);
  });
});
