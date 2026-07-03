import { describe, expect, it } from "vitest";
import {
  buildImageStats,
  buildImageStatsFromSizes,
  formatBytes,
  formatFromContentType,
  formatFromPath,
  parseImageStats
} from "@/lib/image-stats";

describe("formatFromContentType", () => {
  it("maps the common image content types", () => {
    expect(formatFromContentType("image/jpeg")).toBe("jpeg");
    expect(formatFromContentType("image/jpg")).toBe("jpeg");
    expect(formatFromContentType("image/png")).toBe("png");
    expect(formatFromContentType("image/webp")).toBe("webp");
    expect(formatFromContentType("image/avif")).toBe("avif");
    expect(formatFromContentType("image/svg+xml")).toBe("svg");
  });

  it("ignores charset parameters and casing", () => {
    expect(formatFromContentType("IMAGE/PNG; charset=binary")).toBe("png");
  });

  it("returns null for non-image or unknown types", () => {
    expect(formatFromContentType("application/octet-stream")).toBeNull();
    expect(formatFromContentType("")).toBeNull();
    expect(formatFromContentType(null)).toBeNull();
  });
});

describe("formatFromPath", () => {
  it("maps extensions, treating jpg and jpeg the same", () => {
    expect(formatFromPath("abc.jpg")).toBe("jpeg");
    expect(formatFromPath("abc.JPEG")).toBe("jpeg");
    expect(formatFromPath("abc.webp")).toBe("webp");
  });

  it("buckets junk extensions from URL fallbacks as other", () => {
    // guessExtension copies the remote URL's extension when the
    // content type is unhelpful — .bin and .app exist in production.
    expect(formatFromPath("abc.bin")).toBe("other");
    expect(formatFromPath("abc.app")).toBe("other");
    expect(formatFromPath("no-extension")).toBe("other");
  });
});

describe("buildImageStats", () => {
  it("aggregates totals and per-format buckets, content type winning", () => {
    const stats = buildImageStats([
      { storagePath: "a.bin", contentType: "image/jpeg", byteLength: 3000 },
      { storagePath: "b.png", contentType: "image/png", byteLength: 1000 },
      { storagePath: "c.png", contentType: "image/png", byteLength: 500 }
    ]);
    expect(stats.total_bytes).toBe(4500);
    expect(stats.image_count).toBe(3);
    expect(stats.formats).toEqual({
      jpeg: { count: 1, bytes: 3000 },
      png: { count: 2, bytes: 1500 }
    });
    // Sorted heaviest first for the modal list.
    expect(stats.assets.map((a) => a.path)).toEqual(["a.bin", "b.png", "c.png"]);
  });

  it("falls back to the path extension when the content type is unknown", () => {
    const stats = buildImageStats([
      { storagePath: "a.gif", contentType: "application/octet-stream", byteLength: 10 }
    ]);
    expect(stats.assets[0].format).toBe("gif");
  });

  it("returns an empty measurement for zero images", () => {
    const stats = buildImageStats([]);
    expect(stats).toEqual({
      total_bytes: 0,
      image_count: 0,
      formats: {},
      assets: []
    });
  });
});

describe("buildImageStatsFromSizes", () => {
  it("skips paths missing from the size map instead of counting zero", () => {
    const stats = buildImageStatsFromSizes(["a.jpg", "b.png"], { "a.jpg": 2048 });
    expect(stats.image_count).toBe(1);
    expect(stats.total_bytes).toBe(2048);
    expect(stats.formats).toEqual({ jpeg: { count: 1, bytes: 2048 } });
  });
});

describe("parseImageStats", () => {
  const valid = {
    image_stats: {
      total_bytes: 3000,
      image_count: 2,
      formats: { jpeg: { count: 2, bytes: 3000 } },
      assets: [
        { path: "a.jpg", bytes: 2000, format: "jpeg" },
        { path: "b.jpg", bytes: 1000, format: "jpeg" }
      ]
    }
  };

  it("round-trips a valid payload", () => {
    expect(parseImageStats(valid)).toEqual(valid.image_stats);
  });

  it("returns null when the key is absent or metadata is not an object", () => {
    expect(parseImageStats({})).toBeNull();
    expect(parseImageStats(null)).toBeNull();
    expect(parseImageStats("nope")).toBeNull();
    expect(parseImageStats([])).toBeNull();
  });

  it("drops malformed assets and recomputes totals from survivors", () => {
    const stats = parseImageStats({
      image_stats: {
        total_bytes: 999999,
        image_count: 5,
        formats: {},
        assets: [
          { path: "a.jpg", bytes: 1000, format: "jpeg" },
          { path: "", bytes: 50, format: "png" },
          { bytes: 50, format: "png" },
          null,
          "junk"
        ]
      }
    });
    expect(stats?.image_count).toBe(1);
    expect(stats?.total_bytes).toBe(1000);
  });

  it("coerces bad bytes and unknown formats", () => {
    const stats = parseImageStats({
      image_stats: {
        assets: [
          { path: "a.xyz", bytes: -5, format: "heic" },
          { path: "b.jpg", bytes: Number.NaN, format: "jpeg" }
        ]
      }
    });
    expect(stats?.assets).toEqual([
      { path: "a.xyz", bytes: 0, format: "other" },
      { path: "b.jpg", bytes: 0, format: "jpeg" }
    ]);
  });

  it("keeps a stored zero-image measurement but rejects an empty husk", () => {
    expect(
      parseImageStats({
        image_stats: { total_bytes: 0, image_count: 0, formats: {}, assets: [] }
      })
    ).toEqual({ total_bytes: 0, image_count: 0, formats: {}, assets: [] });
    expect(parseImageStats({ image_stats: {} })).toBeNull();
  });
});

describe("formatBytes", () => {
  it("formats B, KB and MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
  });
});
