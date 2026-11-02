import assert from "node:assert/strict";
import test from "node:test";
import { installCloudRail, railPlaces } from "./cloud-rail.mjs";

const saved = { activeId: "local", environments: [{ id: "own", kind: "remote", name: "Own server", origin: "https://own.example.test" }] };
test("lists this computer beside a user-saved server, without exposing its address", () => {
  const places = railPlaces({ saved });
  assert.deepEqual(places.map(({ id, active }) => [id, Boolean(active)]), [["local", true], ["own", false]]);
  assert.equal(JSON.stringify(places).includes("own.example.test"), false);
  assert.deepEqual(railPlaces({ saved: { activeId: "local", environments: [] } }), []);
});
test("does not restore entries owned by the retired account control plane", () => {
  const places = railPlaces({ saved: { ...saved, environments: [...saved.environments, { id: "old", home: true }, { id: "team", team: {} }, { id: "cloud", cloud: {} }] } });
  assert.deepEqual(places.map(place => place.id), ["local", "own"]);
});
test("native server actions require a listed trusted window and a current place", async () => {
  const handlers = new Map(), opened = [], added = [], removed = [];
  installCloudRail({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, guard: fn => fn, trusted: event => event.trusted === true,
    places: () => railPlaces({ saved }), open: id => opened.push(id), forget: id => { removed.push(id); return true; }, targets: () => [],
    add: { choices: () => ({ link: true, address: true }), run: (kind, link) => added.push([kind, link]) } });
  const call = (channel, trusted, ...args) => handlers.get(channel)({ trusted }, ...args);
  assert.deepEqual(call("workspaces:places", false).places, []);
  assert.throws(() => call("workspaces:open", false, "own"), /only available/);
  assert.throws(() => call("workspaces:open", true, "missing"), /isn't here/);
  call("workspaces:open", true, "own"); assert.deepEqual(opened, ["own"]);
  assert.deepEqual(await call("workspaces:remove", true, "own"), { outcome: "removed" }); assert.deepEqual(removed, ["own"]);
  await assert.rejects(call("workspaces:remove", true, "local"), /isn't here/);
  assert.throws(() => call("workspaces:add", true, "cloud"), /isn't available/);
  assert.throws(() => call("workspaces:add", false, "link", "https://own.example.test/pair"), /only available/);
  call("workspaces:add", true, "link", "https://own.example.test/pair"); assert.deepEqual(added, [["link", "https://own.example.test/pair"]]);
  assert.equal([...handlers.keys()].some(name => /cloud-add|account|sign-in/.test(name)), false);
});
