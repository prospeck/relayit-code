import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it.each([undefined, {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
}])("completes the welcome for this session when storage is unavailable: %s", async (storage) => {
  vi.stubGlobal("localStorage", storage);
  const { emailGateDone, setEmailGateDone } = await import("./welcome-completion");
  expect(emailGateDone()).toBe(false);
  setEmailGateDone("submitted");
  expect(emailGateDone()).toBe(true);
});

it("reads the existing completion marker and persists new completions", async () => {
  const storage = { getItem: vi.fn(() => "skipped"), setItem: vi.fn() };
  vi.stubGlobal("localStorage", storage);
  const { emailGateDone, setEmailGateDone } = await import("./welcome-completion");
  expect(emailGateDone()).toBe(true);
  expect(storage.getItem).toHaveBeenCalledWith("omb-email-gate");
  setEmailGateDone("submitted");
  expect(storage.setItem).toHaveBeenCalledWith("omb-email-gate", "submitted");
});
