import { describe, expect, it } from "vitest";
import {
  heroImageCandidates,
  parseImageDimensions,
  passesDensity
} from "@/lib/notifications/email-thumbs";
import { renderDigestEmail } from "@/lib/digest/render";
import type { DigestModel, DigestPick } from "@/lib/digest/build";

const KB = 1024;

describe("heroImageCandidates", () => {
  it("puts the first heavyweight image ahead of larger later ones", () => {
    const sizes = {
      "logo.png": 8 * KB,
      "opening.jpg": 120 * KB,
      "mid-product.jpg": 400 * KB
    };
    // Document order wins within the heavyweight tier — the first
    // confidently-hero image is the email's visible top.
    expect(
      heroImageCandidates(["logo.png", "opening.jpg", "mid-product.jpg"], sizes)
    ).toEqual(["opening.jpg", "mid-product.jpg"]);
  });

  it("ranks modest images below heavyweight ones, largest first", () => {
    const sizes = {
      "banner.png": 25 * KB,
      "small-hero.jpg": 45 * KB,
      "editorial.jpg": 300 * KB
    };
    expect(
      heroImageCandidates(
        ["banner.png", "small-hero.jpg", "editorial.jpg"],
        sizes
      )
    ).toEqual(["editorial.jpg", "small-hero.jpg", "banner.png"]);
  });

  it("drops logo-sized and non-transformable assets entirely", () => {
    const sizes = {
      "logo.png": 8 * KB,
      "pixel.gif": 1 * KB,
      "logo.svg": 900 * KB
    };
    expect(
      heroImageCandidates(["logo.png", "pixel.gif", "logo.svg"], sizes)
    ).toEqual([]);
  });

  it("ranks GIFs after every static image", () => {
    const sizes = { "anim.gif": 500 * KB, "still.jpg": 100 * KB };
    expect(heroImageCandidates(["anim.gif", "still.jpg"], sizes)).toEqual([
      "still.jpg",
      "anim.gif"
    ]);
  });

  it("skips paths with unknown sizes", () => {
    const sizes = { "known.jpg": 200 * KB };
    expect(heroImageCandidates(["unmeasured.jpg", "known.jpg"], sizes)).toEqual(
      ["known.jpg"]
    );
  });
});

describe("parseImageDimensions", () => {
  it("reads PNG IHDR dimensions", () => {
    const bytes = new Uint8Array(32);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(bytes.buffer).setUint32(16, 1200);
    new DataView(bytes.buffer).setUint32(20, 800);
    expect(parseImageDimensions(bytes)).toEqual({
      width: 1200,
      height: 800,
      format: "png"
    });
  });

  it("reads GIF logical screen dimensions", () => {
    const bytes = new Uint8Array(32);
    bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    bytes[6] = 600 & 0xff;
    bytes[7] = 600 >> 8;
    bytes[8] = 400 & 0xff;
    bytes[9] = 400 >> 8;
    expect(parseImageDimensions(bytes)).toEqual({
      width: 600,
      height: 400,
      format: "gif"
    });
  });

  it("walks JPEG markers to the SOF frame header", () => {
    // SOI, then an APP0 segment, then SOF0 with height 900 / width 1200.
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x84, 0x04, 0xb0,
      0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01
    ]);
    expect(parseImageDimensions(bytes)).toEqual({
      width: 1200,
      height: 900,
      format: "jpeg"
    });
  });

  it("returns null for unknown or truncated data", () => {
    expect(parseImageDimensions(new Uint8Array(8))).toBeNull();
    const junk = new Uint8Array(64).fill(0xab);
    expect(parseImageDimensions(junk)).toBeNull();
  });
});

describe("passesDensity", () => {
  it("rejects flat graphics at production-measured densities", () => {
    // The Garment monogram: 129KB at 6576x3564 (~0.006 bytes/px).
    expect(
      passesDensity(129 * KB, { width: 6576, height: 3564, format: "png" })
    ).toBe(false);
    // Søstrene line drawing: 144KB at 3544x3544 (~0.012 bytes/px).
    expect(
      passesDensity(144 * KB, { width: 3544, height: 3544, format: "png" })
    ).toBe(false);
    // Lalaby wordmark PNG: 133KB at 2000x611 (~0.112 bytes/px) — over the
    // lossy line, but far under what PNG photography compresses to.
    expect(
      passesDensity(133 * KB, { width: 2000, height: 611, format: "png" })
    ).toBe(false);
  });

  it("accepts photography at production-measured densities", () => {
    // Carlsberg hero JPEG: 94KB at 1300x565 (~0.131 bytes/px).
    expect(
      passesDensity(94 * KB, { width: 1300, height: 565, format: "jpeg" })
    ).toBe(true);
    // Søstrene collage PNG: 803KB at 800x531 (~1.9 bytes/px).
    expect(
      passesDensity(803 * KB, { width: 800, height: 531, format: "png" })
    ).toBe(true);
  });

  it("accepts unknown dimensions rather than over-rejecting", () => {
    expect(passesDensity(20 * KB, null)).toBe(true);
  });
});

describe("renderDigestEmail pick previews", () => {
  function modelWith(picks: DigestPick[]): DigestModel {
    return {
      cadence: "daily",
      windowStart: "2026-07-01T00:00:00.000Z",
      windowEnd: "2026-07-02T00:00:00.000Z",
      emailCount: picks.length,
      brandCount: picks.length,
      headline: ["Something happened."],
      picks,
      tail: [],
      nothingUnusual: false
    };
  }

  function pick(overrides: Partial<DigestPick>): DigestPick {
    return {
      brandName: "ARKET",
      subject: "New drop",
      day: "Wed",
      why: null,
      kind: "launch",
      emailId: "email-1",
      thumbnailUrl: null,
      ...overrides
    };
  }

  it("renders the banner preview linked to the pick", () => {
    const { html } = renderDigestEmail(
      modelWith([pick({ thumbnailUrl: "https://cdn.example/hero.avif" })])
    );
    expect(html).toContain('src="https://cdn.example/hero.avif"');
    expect(html).toContain("/explore?email=email-1");
    // Full-width banner under the copy, not a fixed-height side column.
    expect(html).toContain('width="552"');
  });

  it("renders text-only when the pick has no thumbnail", () => {
    const { html } = renderDigestEmail(modelWith([pick({})]));
    expect(html).not.toContain("<img");
  });
});
