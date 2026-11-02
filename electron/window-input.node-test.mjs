import assert from "node:assert/strict";
import test from "node:test";
import { createWindowInput } from "./window-input.mjs";

test("tracks the active window's input without duplicating native listeners", () => {
  let time = 10, count = 0, input;
  const win = { isDestroyed: () => false, webContents: { on: (event, callback) => { assert.equal(event, "before-input-event"); input = callback; count++; } } };
  const tracker = createWindowInput(() => win, () => time);
  assert.equal(tracker.lastInput(), 10); time = 20; assert.equal(tracker.lastInput(), 10);
  input(); assert.equal(tracker.lastInput(), 20); assert.equal(count, 1);
});
