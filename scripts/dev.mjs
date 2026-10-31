#!/usr/bin/env node
// Runs the engine (core) and the web UI together for development in a browser.
// Flags: --mock (offline scripted model), --fake-google (demo inbox). Open http://127.0.0.1:1420
import { spawn } from "node:child_process";

const flags = new Set(process.argv.slice(2));
const env = {
  ...process.env,
  ...(flags.has("--mock") ? { RELAYIT_MOCK_MODEL: "1" } : {}),
  ...(flags.has("--fake-google") ? { RELAYIT_FAKE_GOOGLE: "1" } : {}),
};
const procs = [
  // Windows package-manager shims are .cmd files and require cmd.exe.
  spawn("pnpm", ["--filter", "@relayit/core", "dev"], { stdio: "inherit", env, shell: process.platform === "win32" }),
  spawn("pnpm", ["--filter", "@relayit/desktop", "dev:web"], { stdio: "inherit", env, shell: process.platform === "win32" }),
];
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const p of procs) {
    // Killing cmd.exe alone leaves pnpm, Node's watcher and Vite running.
    if (process.platform === "win32" && p.pid) spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else p.kill("SIGTERM");
  }
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => code && stop());
for (const p of procs) p.on("error", (error) => { console.error(error.message); process.exitCode = 1; stop(); });
