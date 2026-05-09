import { describe, expect, it } from "vitest";
import { buildZipArchive } from "@/lib/zip-stream";

const TEXT_DECODER = new TextDecoder();

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function findEndOfCentralDir(bytes: Uint8Array): number {
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (readUInt32LE(bytes, i) === 0x06054b50) {
      return i;
    }
  }
  return -1;
}

describe("buildZipArchive", () => {
  it("produces a valid ZIP with stored entries that round-trip", () => {
    const helloBytes = new TextEncoder().encode("hello world");
    const otherBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const zip = buildZipArchive([
      { name: "hello.txt", data: helloBytes },
      { name: "nested/binary.bin", data: otherBytes }
    ]);

    expect(readUInt32LE(zip, 0)).toBe(0x04034b50);

    const eocdOffset = findEndOfCentralDir(zip);
    expect(eocdOffset).toBeGreaterThan(0);

    const totalEntries = readUInt16LE(zip, eocdOffset + 10);
    const centralSize = readUInt32LE(zip, eocdOffset + 12);
    const centralStart = readUInt32LE(zip, eocdOffset + 16);

    expect(totalEntries).toBe(2);
    expect(centralStart).toBeGreaterThan(0);
    expect(centralSize).toBeGreaterThan(0);
    expect(centralStart + centralSize).toBe(eocdOffset);

    expect(readUInt32LE(zip, centralStart)).toBe(0x02014b50);

    const helloLocalNameLen = readUInt16LE(zip, 26);
    const helloLocalExtraLen = readUInt16LE(zip, 28);
    const helloDataStart = 30 + helloLocalNameLen + helloLocalExtraLen;
    const helloRoundtrip = TEXT_DECODER.decode(
      zip.slice(helloDataStart, helloDataStart + helloBytes.length)
    );
    expect(helloRoundtrip).toBe("hello world");
  });

  it("handles an empty entry list", () => {
    const zip = buildZipArchive([]);
    const eocdOffset = findEndOfCentralDir(zip);
    expect(eocdOffset).toBe(0);
    expect(readUInt16LE(zip, eocdOffset + 10)).toBe(0);
  });
});
