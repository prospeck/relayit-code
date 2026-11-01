import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it, onTestFinished } from "vitest";
import { safeEnv } from "../src/integrations/mcp.ts";
import { openDatabase } from "../src/store/db.ts";
import { KvRepo } from "../src/store/repo.ts";

describe("MCP child environment", () => {
  it("forwards Windows system variables case-insensitively without inheriting app secrets", () => {
    const env = {
      Path: "C:\\Program Files\\nodejs",
      pathext: ".COM;.EXE;.BAT;.CMD",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      SystemRoot: "C:\\Windows",
      SystemDrive: "C:",
      USERPROFILE: "C:\\Users\\test",
      APPDATA: "roaming",
      LOCALAPPDATA: "local",
      ProgramFiles: "programs",
      "ProgramFiles(x86)": "programs-x86",
      ProgramW6432: "programs-64",
      ProgramData: "data",
      HOMEDRIVE: "C:",
      HOMEPATH: "\\Users\\test",
      TEMP: "temp",
      TMP: "tmp",
      RELAYIT_DEV_TOKEN: "synthetic-placeholder",
      OPENAI_API_KEY: "synthetic-placeholder",
      UNRELATED: "ignored",
    };
    const child = safeEnv(env, "win32");
    expect(child).toEqual(
      Object.fromEntries(
        Object.entries(env)
          .filter(([key]) => !["RELAYIT_DEV_TOKEN", "OPENAI_API_KEY", "UNRELATED"].includes(key))
          .map(([key, value]) => [key.toUpperCase(), value]),
      ),
    );
    expect(Object.keys(child).filter((key) => key.toUpperCase() === "PATH")).toEqual(["PATH"]);
  });

  it("keeps the existing macOS allowlist and ignores absent values", () => {
    expect(
      safeEnv(
        {
          PATH: "/usr/bin",
          HOME: "/home/test",
          LANG: "en_US.UTF-8",
          TMPDIR: "",
          PATHEXT: ".CMD",
          COMSPEC: "cmd.exe",
          RELAYIT_DEV_TOKEN: "synthetic-placeholder",
        },
        "darwin",
      ),
    ).toEqual({ PATH: "/usr/bin", HOME: "/home/test", LANG: "en_US.UTF-8" });
  });

  it("lets the installed SDK resolve a PATH command shim and preserve literal arguments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "relayit MCP shim "));
    const bin = join(directory, "node_modules", ".bin");
    await mkdir(bin, { recursive: true });
    const script = join(directory, "echo.mjs");
    await writeFile(
      script,
      'process.stdin.on("data", () => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "fixture", params: { args: process.argv.slice(2) } }) + "\\n"));\n',
    );
    const shim = join(bin, process.platform === "win32" ? "relayit-test.cmd" : "relayit-test");
    await writeFile(
      shim,
      process.platform === "win32"
        ? `@"${process.execPath}" "${script}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
    );
    if (process.platform !== "win32") await chmod(shim, 0o755);
    const env = safeEnv();
    const args = ["two words", "ampersand&literal", 'a"quote', "semi;colon"];
    const transport = new StdioClientTransport({
      command: "relayit-test",
      args,
      env: { ...env, PATH: bin + delimiter + (env.PATH ?? "") },
      stderr: "pipe",
    });
    onTestFinished(async () => {
      await transport.close();
      await rm(directory, { recursive: true, force: true });
    });
    const received = new Promise((resolve, reject) => {
      transport.onmessage = resolve;
      transport.onerror = reject;
    });
    await transport.start();
    await transport.send({ jsonrpc: "2.0", method: "ping" });
    expect(await received).toEqual({ jsonrpc: "2.0", method: "fixture", params: { args } });
  });
});

describe("sidecar shutdown and disk storage", () => {
  it.each([false, true])(
    "exits cleanly on stdin EOF (during startup: %s)",
    async (duringStartup) => {
      const directory = await mkdtemp(join(tmpdir(), "relayit-sidecar-test-"));
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("../src/main.ts", import.meta.url)),
          "--data-dir",
          directory,
          "--key-from-stdin",
        ],
        {
          env: { ...safeEnv(), RELAYIT_MOCK_MODEL: "1" },
          stdio: ["pipe", "pipe", "ignore"],
          windowsHide: true,
        },
      );
      const closed = new Promise<number | null>((resolve, reject) => {
        child.once("close", resolve);
        child.once("error", reject);
      });
      onTestFinished(async () => {
        if (child.exitCode === null) child.kill();
        await closed;
        await rm(directory, { recursive: true, force: true });
      });
      const ready = new Promise<void>((resolve) => {
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk;
          if (output.includes("RELAYIT_READY ")) resolve();
        });
      });
      child.stdin.write(`RELAYIT_MASTER_KEY=${randomBytes(32).toString("base64")}\n`);
      if (!duringStartup) await ready;
      child.stdin.end();
      expect(await closed).toBe(0);
    },
    15_000,
  );

  it("reopens a WAL database and releases file handles before deleting its directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "relayit-wal-test-"));
    const path = join(directory, "relayit.db");
    const db = await openDatabase(path);
    try {
      await new KvRepo(db).set("test", "persisted");
      const reader = await openDatabase(path);
      try {
        expect(await new KvRepo(reader).get("test")).toBe("persisted");
      } finally {
        await reader.destroy();
      }
    } finally {
      await db.destroy();
    }
    const reopened = await openDatabase(path);
    try {
      expect(await new KvRepo(reopened).get("test")).toBe("persisted");
    } finally {
      await reopened.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
