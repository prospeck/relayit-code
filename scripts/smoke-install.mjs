#!/usr/bin/env node
// Runs on a GitHub machine after packaging: installs a real installer the way a person would, opens the installed app
// with throwaway data, and fails unless the window loads and the demo food connector starts.
//
//   node scripts/smoke-install.mjs <folder-for-the-screenshot> <installer>
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const [out = "smoke-output", installer] = process.argv.slice(2);
if (!installer || !existsSync(installer)) throw new Error(`no installer at ${installer}`);
mkdirSync(out, { recursive: true });
const label = basename(installer).replace(/\.[a-z]+$/, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scratch = mkdtempSync(join(tmpdir(), "relayit-smoke-"));
const windows = process.platform === "win32";
mkdirSync(join(scratch, "home"));

const installed = windows ? await installOnWindows() : installOnMac();
console.log("installed:", installed);

const DEBUG = 9340;
const app = spawn(installed, [`--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(scratch, "user")}`, ...(windows ? [] : ["--use-mock-keychain"])], {
  env: { ...process.env, HOME: join(scratch, "home"), OMB_DATA_DIR: join(scratch, "data"), NODE_OPTIONS: "" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: !windows,
});
let log = "";
app.stdout.on("data", (chunk) => { log += chunk; });
app.stderr.on("data", (chunk) => { log += chunk; });

let failure = null;
try {
  const page = await waitFor(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json();
    return pages.find((candidate) => candidate.type === "page" && /^http:\/\/127\.0\.0\.1:/.test(candidate.url));
  }, 240_000, "the app window never loaded");
  const origin = new URL(page.url).origin;
  console.log("window:", page.url);

  const send = await devtools(page.webSocketDebuggerUrl);
  const text = await waitFor(async () => {
    const shown = (await send("Runtime.evaluate", { expression: "document.body.innerText" })).result.value ?? "";
    return shown.includes("RelayIt") ? shown : null;
  }, 60_000, "the window stayed empty");
  console.log("shows:", text.replace(/\s+/g, " ").slice(0, 200));
  await sleep(8000);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, `${label}.png`), Buffer.from(shot.data, "base64"));

  const post = async (path) => {
    const response = await fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const added = await post("/api/mcp/builtins/food");
  if (added.status >= 300) throw new Error(`could not add the food connector: ${added.status}`);
  const tested = await post("/api/mcp/servers/india-food/test");
  const tools = tested.body?.tools?.map((tool) => tool.name) ?? [];
  if (!tested.body?.ok || !tools.includes("search_restaurants")) throw new Error(`the food connector did not start: ${JSON.stringify(tested.body).slice(0, 400)}`);
  console.log("food connector tools:", tools.length);
} catch (error) {
  failure = error;
  console.error(String(error));
  console.error(log.slice(-3000));
}
stopApp();
await sleep(3000);
process.exit(failure ? 1 : 0);

async function installOnWindows() {
  execFileSync(installer, ["/S"], { stdio: "inherit", timeout: 300_000 });
  const path = join(process.env.LOCALAPPDATA, "Programs", "RelayIt", "RelayIt.exe");
  for (let i = 0; i < 60 && !existsSync(path); i++) await sleep(1000);
  if (!existsSync(path)) throw new Error(`the installer did not create ${path}`);
  return path;
}

function installOnMac() {
  const volume = join(scratch, "volume");
  execFileSync("hdiutil", ["attach", installer, "-nobrowse", "-readonly", "-mountpoint", volume], { stdio: "inherit" });
  const target = join(scratch, "RelayIt.app");
  try {
    execFileSync("ditto", [join(volume, "RelayIt.app"), target], { stdio: "inherit" });
  } finally {
    execFileSync("hdiutil", ["detach", volume, "-force"], { stdio: "inherit" });
  }
  execFileSync("codesign", ["--verify", "--deep", "--strict", target], { stdio: "inherit" });
  return join(target, "Contents", "MacOS", "RelayIt");
}

function stopApp() {
  try {
    if (windows) execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-app.pid, "SIGKILL");
  } catch { /* already gone */ }
}

async function waitFor(check, limitMs, message) {
  const by = Date.now() + limitMs;
  while (Date.now() < by) {
    try {
      const value = await check();
      if (value) return value;
    } catch { /* not ready yet */ }
    await sleep(1500);
  }
  throw new Error(message);
}

function devtools(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const waiting = new Map();
    let next = 1;
    socket.addEventListener("message", (event) => {
      const reply = JSON.parse(event.data);
      waiting.get(reply.id)?.(reply.result);
      waiting.delete(reply.id);
    });
    socket.addEventListener("error", () => reject(new Error("could not reach the app's window")));
    socket.addEventListener("open", () => resolve((method, params) => new Promise((answer) => {
      const id = next++;
      waiting.set(id, answer);
      socket.send(JSON.stringify({ id, method, params }));
    })));
  });
}
