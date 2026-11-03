import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

// The published images: the self-hosted server (the default target) and the
// Cloud home. A pull downloads every layer whose digest changed, and a layer's
// digest changes when anything beneath it does.
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

interface Step { op: string; args: string }
interface Stage { name: string; from: string; steps: Step[] }

function stages(text: string): Stage[] {
  const all: Stage[] = [];
  let pending = "";
  for (const line of text.split("\n")) {
    if (/^\s*#/.test(line) || (!pending && !line.trim())) continue;
    pending += line.endsWith("\\") ? `${line.slice(0, -1)} ` : line;
    if (line.endsWith("\\")) continue;
    const [, op, args] = /^\s*(\S+)\s*([\s\S]*)$/.exec(pending)!;
    pending = "";
    if (op.toUpperCase() === "FROM") {
      const [, from, name] = /^(\S+)(?:\s+AS\s+(\S+))?$/i.exec(args.trim())!;
      all.push({ name: name ?? `#${all.length}`, from, steps: [] });
    } else all.at(-1)?.steps.push({ op: op.toUpperCase(), args: args.trim() });
  }
  return all;
}

const all = stages(dockerfile);
/** Every instruction a target's image is built from, its parents' first. */
function chain(target: string): Step[] {
  const stage = all.find(s => s.name === target);
  if (!stage) throw new Error(`the Dockerfile has no ${target} stage`);
  return [...(all.some(s => s.name === stage.from) ? chain(stage.from) : []), ...stage.steps];
}
const shipped = () => all.filter(s => s.name !== "build" && s.name !== "edge").flatMap(s => s.steps);
const npmInstall = (step: Step) => step.op === "RUN" && /\bnpm install\b/.test(step.args);
const browserRun = () => chain("runtime").find(step => step.op === "RUN" && step.args.includes("agent-browser install"))!;

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("container images", () => {
  it("keeps the self-hosted server as the only application image", () => {
    expect(all.at(-1)!.name).toBe("server");
    expect(all.some(s => s.name === "cloud-home")).toBe(false);
    expect(all.find(s => s.name === "server")!.from).toBe("runtime");
    // the build arg docker-compose.yml passes keeps its name and empty default
    expect(chain("server")).toContainEqual({ op: "ARG", args: 'ENGINES=""' });
  });

  it("puts the browser and the engines beneath the per-commit app files, so a code change leaves them as they were", () => {
    for (const target of ["server"]) {
      const steps = chain(target);
      const heavy = steps.flatMap((step, i) => (npmInstall(step) ? [i] : []));
      const app = steps.flatMap((step, i) => (step.op === "COPY" && !step.args.includes("--from=edge") ? [i] : []));
      // agent-browser + Chrome, then (Cloud home only) pnpm in the tools layer, then the engines, then the app files
      // (and the Cloud home's Caddyfile)
      expect(heavy, target).toHaveLength(2);
      const fromBuild = steps.flatMap((step, i) => (step.op === "COPY" && step.args.includes("--from=build") ? [i] : []));
      expect(fromBuild, target).toHaveLength(4);
      expect(Math.max(...heavy), target).toBeLessThan(Math.min(...app));
      // The Data engine's native tree (DuckDB, resvg) changes on a version bump,
      // not per commit, so it is copied before the per-commit app files.
      const native = steps.findIndex(step => step.op === "COPY" && step.args.includes("/dist-native/duckdb/"));
      expect(native, target).toBeGreaterThan(-1);
      expect(native, target).toBeLessThan(Math.min(...fromBuild.filter(i => i !== native)));
    }
  });

  it("leaves no npm or compile cache in a layer: each install removes its own in the same step", () => {
    const installs = shipped().filter(npmInstall);
    expect(installs).toHaveLength(2);
    for (const { args } of installs) {
      const cache = /--cache (\S+)/.exec(args)?.[1] ?? /\bHOME=(\S+) npm install\b/.exec(args)?.[1];
      expect(cache, args).toMatch(/^\/tmp\//);
      // Every `rm -rf` in the step counts: the Cloud home's tools layer clears apt's lists before its pnpm install.
      const removed = [...args.matchAll(/\brm -rf ([^;&|]+)/g)].flatMap((match) => match[1]!.trim().split(/\s+/));
      expect(removed, args).toEqual(expect.arrayContaining([cache, "/tmp/node-compile-cache"]));
    }
  });

  it("ships app files once with ownership set when they are copied", () => {
    for (const { args } of shipped()) expect(args).not.toMatch(/\bch(own|mod) -R\b/);
    // modes are fixed where the files are built, in a stage that is not shipped
    const build = all.find(s => s.name === "build")!.steps.find(step => step.op === "RUN" && step.args.startsWith("pnpm build:server"))!;
    expect(build.args).toMatch(/ && chmod -R go-w dist dist-server skills$/);
    expect(chain("server").filter(step => step.args.includes("--from=build")).every(step => step.args.startsWith("--from=build --chown=maus:maus "))).toBe(true);
  });


  it("keeps each image's runtime contract", () => {
    const last = (steps: Step[], op: string) => steps.filter(step => step.op === op).at(-1)?.args;
    const server = chain("server");
    expect(last(server, "USER")).toBe("maus");
    expect(last(server, "VOLUME")).toBe('["/data"]');
    expect(last(server, "CMD")).toBe('["node", "dist-server/server-launcher.js"]');
    expect(last(server, "HEALTHCHECK")).toContain("http://127.0.0.1:8799/api/health");
    expect(last(chain("runtime"), "ENV")).toMatch(/^AGENT_BROWSER_EXECUTABLE_PATH=\/opt\/relayit-browser\/chrome .*NODE_ENV=production$/);
  });


  it("never runs a build step with HOME on the volume, so nothing lands in what a fresh volume starts with", () => {
    for (const target of ["server"]) {
      const steps = chain(target);
      const home = steps.findIndex(step => step.op === "ENV" && /(^|\s)HOME=\/data\b/.test(step.args));
      expect(home, target).toBeGreaterThan(-1);
      expect(steps.slice(home).filter(step => step.op === "RUN"), target).toEqual([]);
    }
  });

  it.skipIf(process.platform === "win32")("keeps only agent-browser's native binary, and refuses when the command is not one", () => {
    const { args } = browserRun();
    const start = args.indexOf("native=");
    const end = args.indexOf("&& agent-browser --version", start);
    expect(start).toBeGreaterThan(args.indexOf("agent-browser install"));
    expect(end).toBeGreaterThan(start);
    const prune = args.slice(start, end);
    const run = (target: string, elf = true) => {
      const root = mkdtempSync(join(tmpdir(), "omb-agent-browser-"));
      temporaryDirectories.push(root);
      const bin = join(root, "lib/node_modules/agent-browser/bin");
      mkdirSync(bin, { recursive: true });
      mkdirSync(join(root, "bin"));
      const names = ["agent-browser-darwin-arm64", "agent-browser-linux-arm64", "agent-browser-linux-musl-x64", "agent-browser-linux-x64", "agent-browser-win32-x64.exe", "agent-browser.js"];
      for (const name of names) writeFileSync(join(bin, name), name === "agent-browser-linux-x64" && elf ? "\x7fELF\x02\x01" : "#!/usr/bin/env node\n", { mode: 0o755 });
      symlinkSync(join(bin, target), join(root, "bin/agent-browser"));
      const result = spawnSync("sh", ["-c", prune], { env: { PATH: `${join(root, "bin")}:/usr/bin:/bin` }, encoding: "utf8" });
      return { status: result.status, left: readdirSync(bin).sort(), names };
    };
    expect(run("agent-browser-linux-x64")).toMatchObject({ status: 0, left: ["agent-browser-linux-x64", "agent-browser.js"] });
    // npm linking the JS wrapper instead must stop the build, not delete every native binary
    const wrapper = run("agent-browser.js");
    expect(wrapper.status).not.toBe(0);
    expect(wrapper.left).toEqual(wrapper.names);
    const script = run("agent-browser-linux-x64", false);
    expect(script.status).not.toBe(0);
    expect(script.left).toEqual(script.names);
  });


  it("keys the browser layer on the version it installs", () => {
    const runtime = all.find(s => s.name === "runtime")!.steps;
    const declared = runtime.findIndex(step => step.op === "ARG" && step.args.startsWith("CHROME_CACHE_TAG="));
    // declared after the apt step, so a Chrome release rebuilds only the browser layer
    expect(declared).toBeGreaterThan(runtime.findIndex(step => step.op === "RUN" && step.args.startsWith("apt-get update")));
    expect(declared).toBeLessThan(runtime.indexOf(browserRun()));
    expect(browserRun().args).toContain("${CHROME_CACHE_TAG");

  });

  it("runs every compose service of the server image with an init and Chrome's shared memory", () => {
    for (const file of ["../compose.yaml", "../deploy/docker-compose.yml", "../deploy/podman/compose.yaml"]) {
      const service = parse(readFileSync(new URL(file, import.meta.url), "utf8")).services.omb;
      expect(service.init, file).toBe(true);
      expect(service.shm_size, file).toBe("512m");
    }
  });
});
