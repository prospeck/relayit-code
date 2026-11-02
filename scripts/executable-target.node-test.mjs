import assert from "node:assert/strict";
import test from "node:test";
import { executableTarget } from "./executable-target.mjs";

function fixture(target) {
  const bytes = Buffer.alloc(128);
  if (target.startsWith("darwin-")) {
    bytes.writeUInt32LE(0xfeedfacf, 0);
    bytes.writeUInt32LE(target === "darwin-arm64" ? 0x0100000c : 0x01000007, 4);
  } else if (target.startsWith("linux-")) {
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(bytes);
    bytes.writeUInt16LE(target === "linux-arm64" ? 183 : 62, 18);
  } else {
    bytes.write("MZ", 0, "ascii");
    bytes.writeUInt32LE(0x40, 0x3c);
    bytes.write("PE\0\0", 0x40, "binary");
    bytes.writeUInt16LE(0x8664, 0x44);
  }
  return bytes;
}

test("recognizes the native targets used by browser packaging", () => {
  for (const target of ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"]) {
    assert.equal(executableTarget(fixture(target)), target);
  }
  assert.throws(() => executableTarget(Buffer.from("not an executable")), /unsupported/);
});

test("rejects 32-bit, big-endian, unsupported and truncated ELF headers", () => {
  const arm32 = fixture("linux-arm64"); arm32[4] = 1;
  const bigEndian = fixture("linux-arm64"); bigEndian[5] = 2; bigEndian.writeUInt16BE(183, 18);
  const other = fixture("linux-arm64"); other.writeUInt16LE(40, 18);
  for (const bytes of [arm32, bigEndian, other, fixture("linux-arm64").subarray(0, 19)]) {
    assert.throws(() => executableTarget(bytes), /unsupported/);
  }
});
