import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

export type TranscriptionOptions = { language?: string; prompt?: string };
export interface Transcriber {
  transcribe(
    audio: Buffer,
    mime: string,
    opts?: TranscriptionOptions,
  ): Promise<{ text: string; engine: string }>;
}

function extension(mime: string): string {
  const type = mime.split(";")[0]?.trim().toLowerCase();
  return (
    (
      {
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/mpeg": "mp3",
        "audio/mp3": "mp3",
        "audio/mp4": "m4a",
        "audio/webm": "webm",
        "audio/ogg": "ogg",
        "audio/flac": "flac",
      } as Record<string, string>
    )[type ?? ""] ?? "webm"
  );
}

export class OpenAICompatibleTranscriber implements Transcriber {
  #baseUrl: string;
  #apiKey: string;
  #model: string;
  #fetch: typeof globalThis.fetch;

  constructor({
    baseUrl,
    apiKey,
    model = "whisper-1",
    fetch = globalThis.fetch,
  }: {
    baseUrl: string;
    apiKey: string;
    model?: string;
    fetch?: typeof globalThis.fetch;
  }) {
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#apiKey = apiKey;
    this.#model = model;
    this.#fetch = fetch;
  }

  async transcribe(
    audio: Buffer,
    mime: string,
    opts: TranscriptionOptions = {},
  ): Promise<{ text: string; engine: string }> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(audio)], { type: mime }),
      `audio.${extension(mime)}`,
    );
    form.append("model", this.#model);
    if (opts.language) form.append("language", opts.language);
    if (opts.prompt) form.append("prompt", opts.prompt);
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.#apiKey}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
        redirect: "error",
      });
    } catch {
      throw new Error("Could not reach the transcription service. Please try again.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403)
        throw new Error("Transcription API key was rejected. Update it in Settings → Connections.");
      if (response.status === 429)
        throw new Error("Transcription is rate limited. Please try again shortly.");
      if (response.status >= 500)
        throw new Error(
          "Transcription service is temporarily unavailable. Please try again later.",
        );
      throw new Error(`Transcription failed (HTTP ${response.status}).`);
    }
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      !("text" in result) ||
      typeof result.text !== "string"
    ) {
      throw new Error("Transcription service returned an invalid response.");
    }
    return { text: result.text, engine: this.#model };
  }
}

function runBinary(
  binary: string,
  args: string[],
  timeoutMs: number,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, stdio: "ignore", windowsHide: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        new Error(
          error.code === "ENOENT"
            ? `${label} binary is missing. Install it or update its path.`
            : `Could not start ${label}. Check its path and permissions.`,
        ),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`${label} timed out after ${timeoutMs} ms.`));
      else if (code !== 0) reject(new Error(`${label} failed (exit ${code ?? "signal"}).`));
      else resolve();
    });
  });
}

export class WhisperCppTranscriber implements Transcriber {
  #binaryPath: string;
  #modelPath: string;
  #ffmpegPath: string;
  #timeoutMs: number;

  constructor({
    binaryPath,
    modelPath,
    ffmpegPath = "ffmpeg",
    timeoutMs = 60_000,
  }: {
    binaryPath: string;
    modelPath: string;
    ffmpegPath?: string;
    /** Shorter values are useful for offline process tests. */
    timeoutMs?: number;
  }) {
    this.#binaryPath = binaryPath;
    this.#modelPath = modelPath;
    this.#ffmpegPath = ffmpegPath;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
      throw new Error("timeoutMs must be a positive integer.");
    this.#timeoutMs = timeoutMs;
  }

  async transcribe(
    audio: Buffer,
    mime: string,
    opts: TranscriptionOptions = {},
  ): Promise<{ text: string; engine: string }> {
    try {
      await access(this.#modelPath, constants.R_OK);
    } catch {
      throw new Error(
        "Whisper model is missing or unreadable. Set WHISPER_MODEL or add a ggml model in ~/.relayit/models/.",
      );
    }
    const directory = await mkdtemp(join(tmpdir(), "relayit-whisper-"));
    try {
      const input = join(directory, `input.${extension(mime)}`);
      const wav = join(directory, "audio.wav");
      const output = join(directory, "transcription");
      await writeFile(input, audio, { mode: 0o600 });
      const deadline = Date.now() + this.#timeoutMs;
      const remaining = () => Math.max(1, deadline - Date.now());
      await runBinary(
        this.#ffmpegPath,
        ["-nostdin", "-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
        remaining(),
        "ffmpeg",
      );
      const args = [
        "-m",
        this.#modelPath,
        "-f",
        wav,
        "-nt",
        "-l",
        opts.language ?? "auto",
        "-otxt",
        "-of",
        output,
      ];
      if (opts.prompt) args.push("--prompt", opts.prompt);
      await runBinary(this.#binaryPath, args, remaining(), "whisper.cpp");
      let text: string;
      try {
        text = await readFile(`${output}.txt`, "utf8");
      } catch {
        throw new Error("whisper.cpp did not produce a transcription text file.");
      }
      return { text: text.trim(), engine: "whisper.cpp" };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export type LocalWhisperDetection = {
  available: boolean;
  binaryPath: string | null;
  modelPath: string | null;
  ffmpegPath: string | null;
  missing: string[];
};

async function accessible(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function detectLocalWhisper({
  searchPaths,
  env = process.env,
  platform = process.platform,
}: {
  /** Overrides executable directories, including the usual Homebrew defaults. */
  searchPaths?: string[];
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
} = {}): Promise<LocalWhisperDetection> {
  const windows = platform === "win32";
  const path = windows
    ? Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1]
    : env.PATH;
  const defaults = windows
    ? env.LOCALAPPDATA
      ? [join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links")]
      : []
    : ["/opt/homebrew/bin", "/usr/local/bin"];
  const paths = searchPaths ?? [
    ...(path ?? "").split(windows ? ";" : delimiter).filter(Boolean),
    ...defaults,
  ];
  async function find(names: string[]): Promise<string | null> {
    for (const name of names) {
      for (const directory of paths) {
        const candidate = resolve(directory, windows ? `${name}.exe` : name);
        if (await accessible(candidate, windows ? constants.F_OK : constants.X_OK))
          return candidate;
      }
    }
    return null;
  }
  const binaryPath = await find(["whisper-cli", "whisper-cpp", "main"]);
  const ffmpegPath = await find(["ffmpeg"]);
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const models = join(home, ".relayit", "models");
  let modelPath: string | null = null;
  if (env.WHISPER_MODEL) {
    const candidate = env.WHISPER_MODEL.startsWith("~/")
      ? join(home, env.WHISPER_MODEL.slice(2))
      : resolve(env.WHISPER_MODEL);
    if (await accessible(candidate, constants.R_OK)) modelPath = candidate;
  } else {
    let names: string[] = [];
    try {
      names = (await readdir(models)).sort();
    } catch {
      /* Models have not been installed yet. */
    }
    for (const name of names) {
      if (/^ggml.*\.bin$/i.test(name) && (await accessible(join(models, name), constants.R_OK))) {
        modelPath = join(models, name);
        break;
      }
    }
  }
  const missing = [
    !binaryPath && "whisper.cpp",
    !modelPath && "ggml model",
    !ffmpegPath && "ffmpeg",
  ].filter((item): item is string => Boolean(item));
  return { available: missing.length === 0, binaryPath, modelPath, ffmpegPath, missing };
}

export type TranscriberSelection = { transcriber: Transcriber | null; message: string | null };

export function pickTranscriber({
  local,
  openaiKey,
  groqKey,
  fetch,
  openaiBaseUrl = "https://api.openai.com/v1",
  groqBaseUrl = "https://api.groq.com/openai/v1",
}: {
  local?: LocalWhisperDetection | Transcriber | null;
  openaiKey?: string | null;
  groqKey?: string | null;
  fetch?: typeof globalThis.fetch;
  openaiBaseUrl?: string;
  groqBaseUrl?: string;
}): TranscriberSelection {
  if (local && "transcribe" in local) return { transcriber: local, message: null };
  if (local?.available && local.binaryPath && local.modelPath && local.ffmpegPath) {
    return {
      transcriber: new WhisperCppTranscriber({
        binaryPath: local.binaryPath,
        modelPath: local.modelPath,
        ffmpegPath: local.ffmpegPath,
      }),
      message: null,
    };
  }
  if (groqKey?.trim())
    return {
      transcriber: new OpenAICompatibleTranscriber({
        baseUrl: groqBaseUrl,
        apiKey: groqKey,
        model: "whisper-large-v3-turbo",
        fetch,
      }),
      message: null,
    };
  if (openaiKey?.trim())
    return {
      transcriber: new OpenAICompatibleTranscriber({
        baseUrl: openaiBaseUrl,
        apiKey: openaiKey,
        fetch,
      }),
      message: null,
    };
  return {
    transcriber: null,
    message:
      "Enable voice by installing whisper.cpp, ffmpeg and a ggml model in ~/.relayit/models/ (or set WHISPER_MODEL), or add a Groq or OpenAI key in Settings → Connections.",
  };
}
