import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyStartupPreferences, parseArgs, runAccess, type CliOptions, verifyPhoneEndpoint } from "./cli.ts";

import { readAdminActivityRange } from "./admin-activity.ts";

import { removeTempDir } from "./testing/cleanup.ts";



const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const setup = vi.hoisted(() => ({ runSetup: vi.fn(), isSetupComplete: vi.fn(), readCliStartup: vi.fn(), saveCliStartup: vi.fn() }));
vi.mock("./cli-setup.ts", () => setup);





describe("saved startup access", () => {
  const options = () => parseArgs([], {}) as CliOptions;
  it("keeps local launches local and supports a one-time local override", () => {
    expect(applyStartupPreferences(options(), { access: "local" })).toMatchObject({ tailscale: false, publicUrl: undefined });
    expect(applyStartupPreferences({ ...options(), local: true }, { access: "tunnel", phone: "ios" })).toMatchObject({ phone: undefined });
  });
  it("explicit route flags take priority over saved settings", () => {
    expect(applyStartupPreferences({ ...options(), tailscale: true }, { access: "tunnel" })).toMatchObject({ tailscale: true, });
  });
  it("refuses a saved URL that embeds a credential or points to localhost", () => {
    for (const publicUrl of ["https://localhost", "https://user:secret@example.com", "https://example.com/pair#code=secret"])
      expect(() => applyStartupPreferences(options(), { access: "public-url", publicUrl })).toThrow("not a valid HTTPS origin");
  });
});

describe("phone endpoint identity", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("checks the public endpoint matches this server without sending credentials", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ environmentId: "fixture" }))
      .mockResolvedValueOnce(Response.json({ environmentId: "fixture" }));
    vi.stubGlobal("fetch", fetcher);
    expect(await verifyPhoneEndpoint(18451, "https://maus.example.com")).toBe(true);
    expect(fetcher.mock.calls[1]![1]).toMatchObject({ redirect: "error" });
    expect(fetcher.mock.calls[1]![1]).not.toHaveProperty("headers");
  });
  it("refuses another server or unreachable origin", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ environmentId: "ours" }))
      .mockResolvedValueOnce(Response.json({ environmentId: "other" })));
    expect(await verifyPhoneEndpoint(18451, "https://maus.example.com")).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await verifyPhoneEndpoint(18451, "https://maus.example.com")).toBe(false);
    expect(await verifyPhoneEndpoint(18451, "https://localhost")).toBe(false);
  });
});

const exited = (child: ChildProcess) => (child.exitCode !== null ? Promise.resolve(child.exitCode) : new Promise<number | null>((done) => child.once("exit", (code) => done(code))));



describe("openmausbot access", () => {
  it("edits the sign-in allow-list in config.json without a running server", async () => {
    const home = mkdtempSync(join(tmpdir(), "omb-cli-access-"));
    const dataDir = join(home, "data");
    const out: string[] = [];
    const err: string[] = [];
    const io = { log: (line: string) => out.push(line), error: (line: string) => err.push(line), ask: async () => "" };
    const base = { command: "access" as const, port: 1, dataDir, tailscale: false, client: false, pair: true, json: false };
    try {
      expect(await runAccess({ ...base, accessAction: "list" }, io)).toBe(0);
      expect(out.at(-1)).toMatch(/pairing codes only/);
      expect(await runAccess({ ...base, accessAction: "add", email: "Her@Example.test" }, io)).toBe(0);
      expect(await runAccess({ ...base, accessAction: "add", email: "@agentada.test", chatOnly: true }, io)).toBe(0);
      expect(await runAccess({ ...base, accessAction: "add", email: "not-an-email" }, io)).toBe(2);
      const saved = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
      expect(saved.signIn).toEqual({ admins: ["her@example.test"], members: ["@agentada.test"] });
      expect(await runAccess({ ...base, accessAction: "add", email: "her@example.test", chatOnly: true }, io)).toBe(0);
      expect(JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")).signIn).toEqual({ admins: [], members: ["@agentada.test", "her@example.test"] });
      out.length = 0;
      expect(await runAccess({ ...base, accessAction: "list" }, io)).toBe(0);
      expect(out.join("\n")).toMatch(/@agentada.test\s+chat and approvals/);
      expect(await runAccess({ ...base, accessAction: "remove", email: "her@example.test" }, io)).toBe(0);
      expect(await runAccess({ ...base, accessAction: "remove", email: "her@example.test" }, io)).toBe(1);
      expect(JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")).signIn).toEqual({ admins: [], members: ["@agentada.test"] });
      const rows = readAdminActivityRange(dataDir, { from: new Date(Date.now() - 600_000), to: new Date(Date.now() + 600_000) });
      expect(rows.map((row) => [row.action, row.actor.kind, row.changed])).toEqual([
        ["people.update", "cli", ["signIn.members"]],
        ["people.update", "cli", ["signIn.admins", "signIn.members"]],
        ["people.update", "cli", ["signIn.members"]],
      ]);
      expect(rows[0]!.after).toEqual({ "signIn.members": ["@agentada.test"] });
    } finally {
      await removeTempDir(home);
    }
  });
});

describe.skipIf(process.platform === "win32")("serve --domain", () => {
  it("runs a managed Caddy for the domain and serves the pairing link there", async () => {
    const home = mkdtempSync(join(tmpdir(), "omb-cli-domain-"));
    const dataDir = join(home, "data");
    mkdirSync(dataDir, { recursive: true });
    const fake = join(home, "fake-caddy");
    writeFileSync(fake, `#!/bin/sh\necho "$@" > "${join(home, "caddy-args.txt")}"\necho $$ > "${join(home, "caddy.pid")}"\nexec sleep 300\n`, { mode: 0o755 });
    const port = 21000 + Math.floor(Math.random() * 9000);
    const child = spawn(process.execPath, ["--experimental-strip-types", join(SERVER_DIR, "openmausbot.ts"), "serve", "--domain", "omb.example.test", "--port", String(port), "--data-dir", dataDir], {
      cwd: join(SERVER_DIR, ".."),
      env: { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, OMB_WEBHOOK_PORT: String(port + 1), OMB_BROWSER_CONNECTION: join(home, "browser-connection.json"), OMB_CADDY_PATH: fake },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (chunk) => (out += String(chunk)));
    child.stderr?.on("data", (chunk) => (out += String(chunk)));
    try {
      const deadline = Date.now() + 60_000;
      while (!out.includes("open or scan:") && Date.now() < deadline && child.exitCode === null) await new Promise((r) => setTimeout(r, 200));
      expect(out).toContain(`OpenMausBot is running on http://127.0.0.1:${port}, reachable at https://omb.example.test`);
      expect(out).toContain("https: Caddy serves https://omb.example.test");
      expect(out).toContain("open or scan:  https://omb.example.test/pair#code=");
      const args = readFileSync(join(home, "caddy-args.txt"), "utf8").trim();
      expect(args).toMatch(/^run --config .*Caddyfile --adapter caddyfile$/);
      const caddyfile = readFileSync(join(dataDir, "caddy", "Caddyfile"), "utf8");
      expect(caddyfile).toContain("omb.example.test {");
      expect(caddyfile).toContain(`reverse_proxy 127.0.0.1:${port}`);
      expect(caddyfile).toContain(`reverse_proxy 127.0.0.1:${port + 1}`);
    } finally {
      // Cleanup must not mask the real failure: a server that never reached
      // the Caddy step has no pid file, and the assertions above already
      // named what actually went wrong.
      const caddyPid = existsSync(join(home, "caddy.pid")) ? Number(readFileSync(join(home, "caddy.pid"), "utf8").trim() || "0") : 0;
      child.kill("SIGTERM");
      await exited(child);
      await new Promise((r) => setTimeout(r, 300));
      if (caddyPid) expect(() => process.kill(caddyPid, 0)).toThrow();
      await removeTempDir(home);
    }
  }, 120_000);
});
