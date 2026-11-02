import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import test from "node:test";
import vm from "node:vm";
import { createDesktopPrefs, registerDesktopPrefs } from "./desktop-prefs.mjs";
import { WELCOME_VERSION } from "./onboarding-record.mjs";

const require = createRequire(import.meta.url);
const environments = require("./environments.cjs");
const localOrigin = require("./local-origin.cjs");

const POPUP = "whats-new-2026-11", BOAT = "boat-credit-2026-11";
const NOON = new Date(2026, 9, 16, 12).getTime();
const LOCAL = "http://127.0.0.1:18799", CLOUD = "https://omb-u-1.fly.dev", VPS = "https://bots.example.test";

const WELCOMED = { onboarding: { completedAt: "2026-10-01T09:00:00.000Z", version: WELCOME_VERSION, hintsSeen: [] } };
function desktopMain({ offered = true, page = event => event.page, config = () => WELCOMED, record = null } = {}) {
  const handlers = new Map(), listeners = new Map(), calls = [], told = [];
  let saved = record, now = NOON;
  registerDesktopPrefs({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on: (channel, listener) => listeners.set(channel, listener) },
    read: () => saved, write: value => { saved = structuredClone(value); }, page,
    cloudOffered: async () => { calls.push("offered"); return offered; },
    localConfig: () => config(),
    languageChanged: (language, sender) => told.push([language, sender]),
    now: () => now,
    systemName: async () => "Ada Lovelace",
  });
  const ask = (channel, page, ...args) => handlers.get(channel)({ page, sender: `${page}-page` }, ...args);
  const answer = channel => page => { const event = { page }; listeners.get(channel)(event); return event.returnValue; };
  return { ask, read: answer("desktop-analytics:read"), language: answer("desktop-language:read"), told, calls, channels: [...handlers.keys()], saved: () => saved, later: ms => { now += ms; } };
}

test("a first run's default name for the profile goes to this computer's own page only", async () => {
  const main = desktopMain();
  assert.equal(await main.ask("desktop-profile:system-name", "local"), "Ada Lovelace");
  for (const page of ["cloud", "server"]) assert.throws(() => main.ask("desktop-profile:system-name", page), /only available in this app's window/, page);
});

test("the app language picked on any page of the window is the one every page reads, and it outlives a restart", async () => {
  const main = desktopMain();
  for (const page of ["local", "cloud", "server", null]) assert.equal(main.language(page), null, `System until a pick: ${page}`);
  assert.equal(await main.ask("desktop-language:set", "local", "en"), true);
  for (const page of ["local", "cloud", "server"]) assert.equal(main.language(page), "en", page);
  assert.deepEqual(main.told, [["en", "local-page"]], "the other pages hear it");
  assert.equal(await main.ask("desktop-language:set", "server", "de"), true, "a team's or a saved server's page picks for this computer too");
  assert.equal(await main.ask("desktop-language:set", "cloud", "de"), true);
  assert.equal(main.language("local"), "de");
  assert.deepEqual(main.told, [["en", "local-page"], ["de", "server-page"]], "told once per change");
  assert.equal(await main.ask("desktop-language:set", "cloud", ""), true, "System is a pick too");
  assert.equal(main.language("server"), "");
  assert.equal(main.language(null), null, "a page outside this desktop's window is told nothing");
  for (const bad of ["../../etc", "<b>", "x".repeat(40), 42, null, undefined, { toString: () => "en" }]) {
    assert.equal(await main.ask("desktop-language:set", "local", bad), false, String(bad));
  }
  assert.throws(() => main.ask("desktop-language:set", null, "en"), /only available in this app's window/);
  assert.equal(main.language("local"), "");
  assert.equal(main.told.length, 3);

  const restarted = desktopMain({ record: main.saved() });
  assert.equal(restarted.language("cloud"), "");
  await restarted.ask("desktop-language:set", "local", "pt-br");
  assert.equal(desktopMain({ record: restarted.saved() }).language("server"), "pt-br");
  for (const record of [{ language: "<script>" }, { language: 7 }, { language: "x".repeat(40) }]) {
    assert.equal(createDesktopPrefs({ read: () => record, write: () => {} }).language(), null, JSON.stringify(record));
  }
  const broken = desktopMain({ page: () => { throw new Error("Object has been destroyed"); } });
  assert.equal(broken.language("local"), null);
});

const PRELOAD = readFileSync(new URL("./preload.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
function preload(origin, { activation = false, saved = null, language = null } = {}) {
  let bridge;
  const invoked = [], synced = [], heard = new Map();
  vm.runInNewContext(PRELOAD, {
    process: { platform: "darwin", argv: [`--omb-local-origin=${LOCAL}`, "--omb-company-desktop=1"] },
    location: { origin }, navigator: { userActivation: { isActive: activation } }, TextEncoder, localStorage: { getItem: () => null },
    require: () => ({ webUtils: {}, contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: { on(channel, handler) { heard.set(channel, handler); }, removeListener() {}, send() {},
        sendSync: channel => { synced.push(channel); return channel === "desktop-analytics:read" ? saved : channel === "desktop-language:read" ? language : undefined; },
        invoke: (...args) => { invoked.push(args); return Promise.resolve(true); } } }),
  });
  return { bridge, invoked, synced, tell: (channel, ...args) => heard.get(channel)({}, ...args) };
}

test("the preload gives every page of the window the app language this computer keeps", async () => {
  for (const origin of [LOCAL, CLOUD, VPS]) {
    const page = preload(origin, { language: "de" });
    assert.deepEqual(Object.keys(page.bridge.desktopLanguage), ["choice", "set", "onChange"], origin);
    const asked = () => page.synced.filter(channel => channel.startsWith("desktop-"));
    assert.deepEqual(asked(), [], "nothing is asked until the language is");
    assert.equal(page.bridge.desktopLanguage.choice(), "de", origin);
    assert.equal(page.bridge.desktopLanguage.choice(), "de");
    assert.deepEqual(asked(), ["desktop-language:read"], "asked once a page");
    await page.bridge.desktopLanguage.set("en");
    assert.equal(page.bridge.desktopLanguage.choice(), "en", "answered at once, before main replies");
    assert.deepEqual(page.invoked, [["desktop-language:set", "en"]]);
    const heard = [];
    const stop = page.bridge.desktopLanguage.onChange(language => heard.push(language));
    page.tell("desktop-language:changed", "ja");
    page.tell("desktop-language:changed", 42);
    assert.equal(page.bridge.desktopLanguage.choice(), "ja", "a pick made on another page");
    assert.deepEqual(heard, ["ja"]);
    stop();
    page.tell("desktop-language:changed", "fr");
    assert.deepEqual(heard, ["ja"]);
    assert.equal(page.bridge.desktopLanguage.choice(), "fr");
  }
  assert.equal(preload(VPS, { language: 7 }).bridge.desktopLanguage.choice(), null);
  const safe = PRELOAD.match(/const REMOTE_SAFE = new Set\(\[([^\]]*)\]\)/)[1];
  assert.ok(safe.includes('"desktopLanguage"'));
});

test("the window's rail of places is shown until the person hides it, and the choice survives a restart", () => {
  let saved = null, writes = 0;
  const prefs = createDesktopPrefs({ read: () => saved, write: value => { saved = structuredClone(value); writes++; } });
  assert.equal(prefs.railHidden(), false);
  prefs.setRailHidden(false);
  assert.equal(writes, 0, "showing a rail that shows writes nothing");
  prefs.setRailHidden(true);
  assert.equal(createDesktopPrefs({ read: () => saved, write: () => {} }).railHidden(), true);
  prefs.setRailHidden("no");
  assert.equal(createDesktopPrefs({ read: () => saved, write: () => {} }).railHidden(), false, "only true hides it");
  assert.equal(createDesktopPrefs({ read: () => ({ railHidden: "yes" }), write: () => {} }).railHidden(), false);
});

test("the talk shortcut is on with ⌃⌥Space until changed, and the choice survives a restart", () => {
  let saved = null;
  const prefs = createDesktopPrefs({ read: () => saved, write: value => { saved = structuredClone(value); } });
  assert.equal(prefs.talkShortcut(), true);
  assert.equal(prefs.talkKey(), "ctrl-opt-space");
  prefs.setTalkShortcut(false);
  assert.equal(prefs.setTalkKey("opt-shift-space"), true);
  for (const key of ["cmd-space", "__proto__", "toString", 7]) assert.equal(prefs.setTalkKey(key), false);
  const restarted = createDesktopPrefs({ read: () => saved, write: () => {} });
  assert.equal(restarted.talkShortcut(), false);
  assert.equal(restarted.talkKey(), "opt-shift-space");
  const junk = createDesktopPrefs({ read: () => ({ talkShortcut: "off", talkKey: "toString" }), write: () => {} });
  assert.equal(junk.talkShortcut(), true);
  assert.equal(junk.talkKey(), "ctrl-opt-space");
});

test("each server keeps its own Quick asks chat; nothing malformed is read back", () => {
  let saved = null;
  const prefs = createDesktopPrefs({ read: () => saved, write: value => { saved = structuredClone(value); } });
  prefs.setQuickAsksChat("/Users/a/.openmausbot", { botId: "bot-1", threadId: "t-1" });
  assert.deepEqual(createDesktopPrefs({ read: () => saved, write: () => {} }).quickAsksChat("/Users/a/.openmausbot"), { botId: "bot-1", threadId: "t-1" });
  assert.equal(prefs.quickAsksChat("/Users/a/.openmausbot-aprs"), null);
  const broken = createDesktopPrefs({ read: () => ({ quickAsks: { a: { botId: "../x", threadId: "t" }, b: "t-1", c: { botId: "b", threadId: "t", extra: 1 } } }), write: () => {} });
  assert.equal(broken.quickAsksChat("a"), null);
  assert.equal(broken.quickAsksChat("b"), null);
  assert.deepEqual(broken.quickAsksChat("c"), { botId: "b", threadId: "t" });
});

test("the window draws its own frame until the person turns it off, and the choice survives a restart", () => {
  let saved = null, writes = 0;
  const prefs = createDesktopPrefs({ read: () => saved, write: value => { saved = structuredClone(value); writes++; } });
  assert.equal(prefs.windowFrame(), true);
  prefs.setWindowFrame(true);
  assert.equal(writes, 0, "turning on a frame that is on writes nothing");
  prefs.setWindowFrame(false);
  assert.equal(createDesktopPrefs({ read: () => saved, write: () => {} }).windowFrame(), false);
  prefs.setWindowFrame("off");
  assert.equal(createDesktopPrefs({ read: () => saved, write: () => {} }).windowFrame(), true, "only false turns it off");
  assert.equal(createDesktopPrefs({ read: () => ({ windowFrame: "no" }), write: () => {} }).windowFrame(), true);
});

test("Settings reads and changes the window's frame on any page of the window; on Windows the change waits for a restart", async () => {
  const prefs = createDesktopPrefs({ read: () => null, write: () => {} });
  const handlers = new Map();
  let made = true, changes = 0, asking = "server";
  const register = (restarts) => registerDesktopPrefs({ prefs, ipcMain: { handle: (c, h) => handlers.set(c, h), on: () => {} }, read: () => null, write: () => {},
    page: () => asking, cloudOffered: async () => false, frame: { made: () => made, restarts, changed: () => { changes++; } } });
  register(false);
  assert.deepEqual(await handlers.get("window-frame:state")({}), { on: true, restart: false });
  assert.deepEqual(await handlers.get("window-frame:set")({}, false), { on: false, restart: false }, "macOS: at once");
  assert.equal(changes, 1, "the pages hear it");
  register(true);
  assert.deepEqual(await handlers.get("window-frame:state")({}), { on: false, restart: true }, "Windows: the window was made with its frame");
  assert.deepEqual(await handlers.get("window-frame:set")({}, true), { on: true, restart: false }, "back as it was made: nothing to restart");
  made = null;
  assert.deepEqual(await handlers.get("window-frame:set")({}, false), { on: false, restart: false }, "no window yet");
  asking = null;
  assert.throws(() => handlers.get("window-frame:set")({}, true), /only available in this app's window/);
});
