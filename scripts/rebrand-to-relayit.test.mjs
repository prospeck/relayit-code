import assert from "node:assert/strict";
import { test } from "node:test";

import { isKept, renameText, upstreamAddresses } from "./rebrand-to-relayit.mjs";

test("renames every spelling, keeping its case", () => {
  assert.equal(renameText("OpenMausBot"), "RelayIt");
  assert.equal(renameText("MausBot"), "RelayIt");
  assert.equal(renameText("openmausbot-browser"), "relayit-browser");
  assert.equal(renameText("~/.openmausbot/config.json"), "~/.relayit/config.json");
  assert.equal(renameText("OPENMAUSBOT_URL"), "RELAYIT_URL");
  assert.equal(renameText("isMausBot(bot)"), "isRelayIt(bot)");
  assert.equal(renameText("mausBotId"), "relayItId");
  assert.equal(renameText("x-openmausbot-desktop-owner"), "x-relayit-desktop-owner");
  assert.equal(renameText("com.openmausbot.app"), "com.relayit.app");
});

test("leaves other words alone", () => {
  for (const text of ["OMB_DATA_DIR", "Mouse", "famous", "Milind Soni", "Grok Bot"]) {
    assert.equal(renameText(text), text);
  }
});

test("finds upstream addresses rather than turning them into domains we don't own", () => {
  assert.deepEqual(upstreamAddresses("see https://accounts.openmausbot.com/login"), ["accounts.openmausbot.com"]);
  assert.deepEqual(upstreamAddresses("https://app.mausbot.si and x.mausbot.page"), ["app.mausbot.si", "x.mausbot.page"]);
  assert.deepEqual(upstreamAddresses("github.com/milind-soni/OpenMausBot"), ["github.com/milind-soni/OpenMausBot"]);
  assert.deepEqual(upstreamAddresses("openmausbot-composio.milindsoni201.workers.dev"), ["openmausbot-composio.milindsoni201.workers.dev"]);
  assert.deepEqual(upstreamAddresses("~/.openmausbot/config.json and openmausbot.js"), []);
});

test("never touches the files the licence requires", () => {
  for (const path of ["LICENSE", "NOTICE", "UPSTREAM.md", "LICENSING.md", "third_party/t3-code/LICENSE"]) {
    assert.equal(isKept(path), true, path);
  }
  for (const path of ["README.md", "server/index.ts", "src/third_party_note.ts"]) {
    assert.equal(isKept(path), false, path);
  }
});
