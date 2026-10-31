import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleTranscriber, WhisperCppTranscriber, detectLocalWhisper, pickTranscriber } from "../src/index.ts";

// Interpret fake native executables with Node on every OS, keeping real process/timeout/cleanup checks.
vi.mock("node:child_process", async (importOriginal) => {
  const { spawn } = await importOriginal<typeof import("node:child_process")>();
  return { spawn: vi.fn((binary: string, args: string[], options: Parameters<typeof spawn>[2]) =>
    existsSync(binary) ? spawn(process.execPath, [binary, ...args], options) : spawn(binary, args, options)) };
});

let baseUrl: string;
let handle: (request: IncomingMessage, response: ServerResponse) => void;
const server = createServer((request, response) => handle(request, response));
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server address");
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("OpenAI-compatible transcription", () => {
  it.each(["whisper-1", "gpt-4o-mini-transcribe", "whisper-large-v3-turbo"])("uploads multipart audio using %s", async (model) => {
    let received: { path?: string; auth?: string; type?: string; body?: string } = {};
    handle = (request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received = { path: request.url, auth: request.headers.authorization, type: request.headers["content-type"], body: Buffer.concat(chunks).toString() };
        response.end(JSON.stringify({ text: "नमस्कार महाराष्ट्र" }));
      });
    };
    const transcriber = new OpenAICompatibleTranscriber({ baseUrl: `${baseUrl}/`, apiKey: "offline-placeholder", model, fetch });
    expect(await transcriber.transcribe(Buffer.from("fake-audio-bytes"), "audio/webm", { language: "mr", prompt: "Agriculture" })).toEqual({ text: "नमस्कार महाराष्ट्र", engine: model });
    expect(received).toMatchObject({ path: "/v1/audio/transcriptions", auth: "Bearer offline-placeholder" });
    expect(received.type).toMatch(/^multipart\/form-data; boundary=/);
    expect(received.body).toContain('name="file"; filename="audio.webm"');
    expect(received.body).toContain("Content-Type: audio/webm");
    expect(received.body).toContain("fake-audio-bytes");
    expect(received.body).toContain(`name="model"\r\n\r\n${model}`);
    expect(received.body).toContain('name="language"\r\n\r\nmr');
    expect(received.body).toContain('name="prompt"\r\n\r\nAgriculture');
  });

  it.each([[401, "API key"], [403, "API key"], [429, "rate limited"], [500, "temporarily unavailable"], [503, "temporarily unavailable"], [400, "HTTP 400"]])("maps HTTP %s without including upstream details", async (status, message) => {
    handle = (_request, response) => { response.writeHead(Number(status)); response.end("private-upstream-body"); };
    await expect(new OpenAICompatibleTranscriber({ baseUrl, apiKey: "offline-placeholder" }).transcribe(Buffer.from("audio"), "audio/wav")).rejects.toThrow(String(message));
  });

  it("rejects a response without transcription text", async () => {
    handle = (_request, response) => { response.end("{}"); };
    await expect(new OpenAICompatibleTranscriber({ baseUrl, apiKey: "offline-placeholder" }).transcribe(Buffer.from("audio"), "audio/wav")).rejects.toThrow("invalid response");
  });

  it("maps network failures without exposing thrown details", async () => {
    const fake = vi.fn<typeof fetch>().mockRejectedValue(new Error("private details"));
    await expect(new OpenAICompatibleTranscriber({ baseUrl, apiKey: "offline-placeholder", fetch: fake }).transcribe(Buffer.from("audio"), "audio/wav")).rejects.toThrow(/^Could not reach the transcription service/);
  });
});

describe("local whisper.cpp", () => {
  let directory: string;
  let binaryPath: string;
  let ffmpegPath: string;
  let modelPath: string;
  const recordArgs = 'const { writeFileSync } = require("node:fs"); const args = process.argv.slice(2); writeFileSync(process.argv[1] + ".args", args.join("\\n") + "\\n");\n';
  const ffmpegScript = recordArgs + 'writeFileSync(args.at(-1), "fake wav");\n';
  const whisperScript = recordArgs + 'writeFileSync(args[args.indexOf("-of") + 1] + ".txt", "  Local transcript  \\n");\n';
  const exe = (name: string) => process.platform === "win32" ? `${name}.exe` : name;

  async function executable(path: string, body: string): Promise<void> { await writeFile(path, body); await chmod(path, 0o755); }
  async function args(path: string): Promise<string[]> { return (await readFile(`${path}.args`, "utf8")).trim().split("\n"); }
  async function expectCleaned(): Promise<void> {
    const values = await args(ffmpegPath);
    const input = values[values.indexOf("-i") + 1]!;
    await expect(access(dirname(input))).rejects.toThrow();
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "relayit-voice-test-"));
    binaryPath = join(directory, exe("whisper-cli"));
    ffmpegPath = join(directory, exe("ffmpeg"));
    modelPath = join(directory, "ggml-test.bin");
    await writeFile(modelPath, "offline model placeholder");
    await executable(ffmpegPath, ffmpegScript);
    await executable(binaryPath, whisperScript);
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it("converts to 16 kHz mono WAV, invokes whisper, reads output and removes its temporary directory", async () => {
    expect(await new WhisperCppTranscriber({ binaryPath, modelPath, ffmpegPath }).transcribe(Buffer.from("audio"), "audio/webm")).toEqual({ text: "Local transcript", engine: "whisper.cpp" });
    expect(spawn).toHaveBeenCalledWith(ffmpegPath, expect.any(Array), { shell: false, stdio: "ignore", windowsHide: true });
    const ffmpegArgs = await args(ffmpegPath);
    expect(ffmpegArgs).toEqual(["-nostdin", "-y", "-i", expect.stringMatching(/input\.webm$/), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", expect.stringMatching(/audio\.wav$/)]);
    const whisperArgs = await args(binaryPath);
    expect(whisperArgs).toEqual(["-m", modelPath, "-f", ffmpegArgs.at(-1), "-nt", "-l", "auto", "-otxt", "-of", expect.stringMatching(/transcription$/)]);
    await expectCleaned();
  });

  it("passes language and prompt as literal arguments without a shell", async () => {
    const prompt = 'names; $(touch should-not-exist) "quoted"';
    await new WhisperCppTranscriber({ binaryPath, modelPath, ffmpegPath }).transcribe(Buffer.from("audio"), "audio/mp4", { language: "mr", prompt });
    const values = await args(binaryPath);
    expect(values[values.indexOf("-l") + 1]).toBe("mr");
    expect(values.slice(-2)).toEqual(["--prompt", prompt]);
    await expectCleaned();
  });

  it.each(["ffmpeg", "whisper"])("cleans up when %s exits with an error", async (which) => {
    const path = which === "ffmpeg" ? ffmpegPath : binaryPath;
    await executable(path, recordArgs + "process.exit(7);\n");
    await expect(new WhisperCppTranscriber({ binaryPath, modelPath, ffmpegPath }).transcribe(Buffer.from("audio"), "audio/webm")).rejects.toThrow("exit 7");
    await expectCleaned();
  });

  it.each(["ffmpeg", "whisper"])("kills a timed-out %s process and cleans up", async (which) => {
    const path = which === "ffmpeg" ? ffmpegPath : binaryPath;
    await executable(path, recordArgs + "setInterval(() => {}, 1000);\n");
    // Leave time for the Node fixture to start on a busy Windows runner before testing the kill.
    await expect(new WhisperCppTranscriber({ binaryPath, modelPath, ffmpegPath, timeoutMs: 5000 }).transcribe(Buffer.from("audio"), "audio/webm")).rejects.toThrow("timed out");
    await expectCleaned();
  }, 15_000);

  it.each(["ffmpeg", "whisper"])("reports a missing %s binary", async (which) => {
    await rm(which === "ffmpeg" ? ffmpegPath : binaryPath);
    await expect(new WhisperCppTranscriber({ binaryPath, modelPath, ffmpegPath }).transcribe(Buffer.from("audio"), "audio/wav")).rejects.toThrow("binary is missing");
    if (which === "whisper") await expectCleaned();
  });

  it("reports missing output and cleans up", async () => {
    await executable(binaryPath, "process.exit(0);\n");
    await expect(new WhisperCppTranscriber({ binaryPath, modelPath, ffmpegPath }).transcribe(Buffer.from("audio"), "audio/webm")).rejects.toThrow("did not produce");
    await expectCleaned();
  });

  it("reports a missing model", async () => {
    await rm(modelPath);
    await expect(new WhisperCppTranscriber({ binaryPath, modelPath, ffmpegPath }).transcribe(Buffer.from("audio"), "audio/webm")).rejects.toThrow("Whisper model is missing");
  });

  it("detects executables and a configured model using injected paths and env", async () => {
    expect(await detectLocalWhisper({ searchPaths: [directory], env: { HOME: directory, WHISPER_MODEL: modelPath } })).toEqual({ available: true, binaryPath, modelPath, ffmpegPath, missing: [] });
  });

  it.each(["whisper-cpp", "main"])("detects the alternate executable %s and a model in the default directory", async (name) => {
    await rm(binaryPath);
    const alternative = join(directory, exe(name));
    await executable(alternative, whisperScript);
    const models = join(directory, ".relayit", "models");
    await mkdir(models, { recursive: true });
    await writeFile(join(models, "ggml-small.bin"), "placeholder");
    expect(await detectLocalWhisper({ env: { HOME: directory, PATH: directory }, searchPaths: [directory] })).toMatchObject({ available: true, binaryPath: alternative, modelPath: join(models, "ggml-small.bin") });
  });

  it("lists missing dependencies without consulting the real PATH", async () => {
    expect(await detectLocalWhisper({ searchPaths: [], env: { HOME: directory } })).toEqual({ available: false, binaryPath: null, modelPath: null, ffmpegPath: null, missing: ["whisper.cpp", "ggml model", "ffmpeg"] });
  });

  it("accepts a model path relative to injected HOME", async () => {
    expect(await detectLocalWhisper({ searchPaths: [directory], env: { HOME: directory, WHISPER_MODEL: "~/ggml-test.bin" } })).toMatchObject({ available: true, modelPath });
  });

  it("detects Windows .exe files through a mixed-case Path and LOCALAPPDATA's WinGet links", async () => {
    const links = join(directory, "Microsoft", "WinGet", "Links");
    await mkdir(links, { recursive: true });
    const whisper = join(directory, "whisper-cli.exe");
    const ffmpeg = join(links, "ffmpeg.exe");
    await writeFile(whisper, "fixture");
    await writeFile(ffmpeg, "fixture");
    expect(await detectLocalWhisper({ platform: "win32", env: { Path: directory, LOCALAPPDATA: directory, USERPROFILE: directory, WHISPER_MODEL: modelPath } }))
      .toEqual({ available: true, binaryPath: whisper, modelPath, ffmpegPath: ffmpeg, missing: [] });
  });
});

describe("transcriber selection", () => {
  it("prefers a supplied local transcriber over both keys", () => {
    const local = { async transcribe() { return { text: "local", engine: "whisper.cpp" }; } };
    expect(pickTranscriber({ local, groqKey: "offline-placeholder", openaiKey: "offline-placeholder" })).toEqual({ transcriber: local, message: null });
  });

  it("creates local whisper.cpp from a successful detection result", () => {
    const local = { available: true, binaryPath: "/fake/whisper-cli", modelPath: "/fake/model.bin", ffmpegPath: "/fake/ffmpeg", missing: [] };
    expect(pickTranscriber({ local, groqKey: "offline-placeholder", openaiKey: "offline-placeholder" }).transcriber).toBeInstanceOf(WhisperCppTranscriber);
  });

  it.each([["offline-placeholder", "offline-placeholder", "whisper-large-v3-turbo"], [null, "offline-placeholder", "whisper-1"]])("selects Groq before OpenAI: %s / %s", async (groqKey, openaiKey, model) => {
    let receivedModel = "";
    handle = (request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => { receivedModel = Buffer.concat(chunks).toString(); response.end('{"text":"cloud"}'); });
    };
    const selection = pickTranscriber({ local: { available: false, binaryPath: null, modelPath: null, ffmpegPath: null, missing: ["whisper.cpp"] }, groqKey, openaiKey, groqBaseUrl: baseUrl, openaiBaseUrl: baseUrl, fetch });
    expect(await selection.transcriber!.transcribe(Buffer.from("audio"), "audio/wav")).toEqual({ text: "cloud", engine: model });
    expect(receivedModel).toContain(`name="model"\r\n\r\n${model}`);
  });

  it("returns null with instructions when nothing is configured", () => {
    const result = pickTranscriber({ openaiKey: " ", groqKey: null });
    expect(result.transcriber).toBeNull();
    expect(result.message).toContain("whisper.cpp, ffmpeg");
    expect(result.message).toContain("Groq or OpenAI key in Settings → Connections");
  });
});
