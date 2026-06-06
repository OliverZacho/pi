import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { isImageBlank } from "@/lib/image-analysis";

/** Solid RGB block (fully opaque), e.g. a spacer / background fill. */
function solid(
  width: number,
  height: number,
  rgb: { r: number; g: number; b: number }
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: rgb }
  })
    .png()
    .toBuffer();
}

/** Fully transparent RGBA canvas, e.g. a tracking/spacer pixel grid. */
function transparent(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .png()
    .toBuffer();
}

/**
 * A crude "wordmark": a transparent canvas with an opaque coloured bar across
 * the middle. RGB is flat (one colour) but the alpha channel varies — the
 * mark's whole shape lives in alpha, exactly like a real monochrome logo.
 */
async function wordmarkOnTransparent(): Promise<Buffer> {
  const width = 200;
  const height = 60;
  const bar = await sharp({
    create: {
      width: 160,
      height: 24,
      channels: 4,
      background: { r: 10, g: 10, b: 10, alpha: 1 }
    }
  })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: bar, top: 18, left: 20 }])
    .png()
    .toBuffer();
}

/** An opaque image with real colour variation (a "photo"-ish hero). */
async function colourfulOpaque(): Promise<Buffer> {
  const left = await sharp({
    create: { width: 100, height: 80, channels: 3, background: { r: 220, g: 30, b: 40 } }
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 200, height: 80, channels: 3, background: { r: 20, g: 90, b: 220 } }
  })
    .composite([{ input: left, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

describe("isImageBlank", () => {
  it("flags a fully transparent canvas as blank", async () => {
    expect(await isImageBlank(await transparent(120, 40))).toBe(true);
  });

  it("flags a solid white block as blank", async () => {
    expect(await isImageBlank(await solid(120, 40, { r: 255, g: 255, b: 255 }))).toBe(true);
  });

  it("flags a solid coloured block as blank", async () => {
    expect(await isImageBlank(await solid(120, 40, { r: 12, g: 80, b: 200 }))).toBe(true);
  });

  it("keeps a monochrome wordmark on a transparent canvas", async () => {
    expect(await isImageBlank(await wordmarkOnTransparent())).toBe(false);
  });

  it("keeps an opaque image with real colour variation", async () => {
    expect(await isImageBlank(await colourfulOpaque())).toBe(false);
  });

  it("does not flag undecodable bytes (keep, never hide a real logo)", async () => {
    expect(await isImageBlank(Buffer.from("not an image"))).toBe(false);
  });
});
