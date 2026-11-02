import assert from "node:assert/strict";
import test from "node:test";
import { installPlaceLook, placeLook } from "./place-look.mjs";

test("saved local and own-server colors are local; retired account entries are omitted", () => {
  assert.deepEqual(placeLook({ id: "local", kind: "local", name: "This computer", color: "teal" }), { name: "This computer", color: "teal", swatch: "green", change: "local" });
  assert.equal(placeLook({ id: "own", name: "My server", origin: "https://own.example.test" }).change, "local");
  assert.equal(placeLook({ id: "retired", home: true, origin: "https://retired.example.test" }), null);
});
test("local color changes require the rail's own window and persist without an account client", async () => {
  let entry = { id: "own", name: "My server", origin: "https://own.example.test", color: "teal" };
  const handlers = new Map();
  installPlaceLook({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, guard: fn => fn, place: () => entry,
    save: (id, color) => { assert.equal(id, "own"); entry = { ...entry, color }; },
    rail: { owns: event => event.trusted, places: () => [{ id: "own", paint: {} }], saved: id => id === "own" ? entry : null } });
  assert.equal(handlers.get("workspaces:look")().change, "local");
  assert.throws(() => handlers.get("workspaces:recolor")({ trusted: false }, "own", "blue"), /only available/);
  const result = await handlers.get("workspaces:recolor")({ trusted: true }, "own", "blue");
  assert.equal(result.outcome, "saved"); assert.equal(result.look.color, "blue");
  await assert.rejects(handlers.get("workspaces:color")({}, "not-a-color"), /Choose one/);
});
