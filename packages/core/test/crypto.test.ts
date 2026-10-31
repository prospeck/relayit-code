import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/crypto/secretbox.ts";

describe("AES-256-GCM secrets", () => {
  const key = randomBytes(32);
  it.each(["", "a secret", "मराठी 🌱\nsecond line"])("round trips %j", (value) => {
    expect(decrypt(key, encrypt(key, value, "secret:test"), "secret:test")).toBe(value);
  });
  it("rejects wrong AAD", () => {
    expect(() => decrypt(key, encrypt(key, "value", "secret:a"), "secret:b")).toThrow();
  });
  it("rejects tampered ciphertext", () => {
    const blob = Buffer.from(encrypt(key, "value", "test"), "base64url");
    blob[29] = blob[29]! ^ 1;
    expect(() => decrypt(key, blob.toString("base64url"), "test")).toThrow();
  });
  it.each([0, 16, 31, 33])("rejects %i-byte keys for encrypt and decrypt", (length) => {
    expect(() => encrypt(Buffer.alloc(length), "value", "test")).toThrow("32 bytes");
    expect(() => decrypt(Buffer.alloc(length), encrypt(key, "value", "test"), "test")).toThrow("32 bytes");
  });
  it("uses distinct IVs for repeated encryptions", () => {
    const ivs = Array.from({ length: 100 }, () => Buffer.from(encrypt(key, "value", "test"), "base64url").subarray(1, 13).toString("hex"));
    expect(new Set(ivs).size).toBe(100);
  });
});
