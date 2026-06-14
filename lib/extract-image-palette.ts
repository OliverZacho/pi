import sharp from "sharp";
import { EMAIL_ASSETS_BUCKET } from "./storage";
import { getSupabaseAdmin } from "./supabase-admin";
import { isImageBlank } from "./image-analysis";

/**
 * Image-based colour palette extraction.
 *
 * The HTML-token extractor in `extract-metadata.ts` only sees the markup's
 * text/background colours, so it surfaces neutral greys. A brand's real colours
 * live in its photography. This module reads the actual pixels of an email's
 * mirrored content images (deterministically, via `sharp` — no LLM, no network
 * model) and returns a weighted palette biased toward chromatic brand colours.
 *
 * The result is stored on `captured_emails.metadata.image_palette` as
 * `{ hex, count }[]` — the same shape `palette_colors` uses — and is preferred
 * over the HTML palette by `computeDesign` (brand-db) and `parsePaletteColors`
 * (admin-db) when present.
 */

export type ImagePaletteColor = { hex: string; count: number };

const SAMPLE_DIM = 72; // downsample each image to this max edge before sampling
const MIN_IMAGE_EDGE = 64; // skip spacers / icons smaller than this
const MAX_DOWNLOADS = 24; // cap assets we fetch per email
const MAX_ANALYSED = 5; // analyse only the N largest content images
const QUANT_BITS = 4; // bits/channel for bucketing → 16 levels/channel
const SHIFT = 8 - QUANT_BITS;
const OUTPUT_LIMIT = 8;
const MERGE_DIST = 30; // RGB euclidean distance under which colours merge

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): { s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

/**
 * Extract a weighted palette from raw image bytes. Pixels are bucketed by
 * quantised RGB; obvious page/ink neutrals are dropped; the rest are weighted by
 * `pixels × saturation` (and per-image area) so accent colours outrank large flat
 * fills, then near-identical buckets are merged.
 */
export async function extractImagePaletteFromImages(
  images: { bytes: Buffer | Uint8Array; area: number }[]
): Promise<ImagePaletteColor[]> {
  if (!images.length) return [];
  const maxArea = Math.max(1, ...images.map((i) => i.area || 1));

  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();

  for (const img of images) {
    let raw: { data: Buffer; info: sharp.OutputInfo };
    try {
      raw = await sharp(img.bytes)
        .resize(SAMPLE_DIM, SAMPLE_DIM, { fit: "inside", withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    } catch {
      continue;
    }
    const { data } = raw;
    const ch = raw.info.channels;
    // Larger images count for more, but sub-linearly so the hero doesn't erase
    // everything else.
    const imgWeight = Math.sqrt((img.area || 1) / maxArea);

    for (let i = 0; i + ch - 1 < data.length; i += ch) {
      const a = ch >= 4 ? data[i + 3] : 255;
      if (a < 128) continue; // skip (semi-)transparent pixels
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key =
        ((r >> SHIFT) << (2 * QUANT_BITS)) | ((g >> SHIFT) << QUANT_BITS) | (b >> SHIFT);
      const e = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
      e.r += r * imgWeight;
      e.g += g * imgWeight;
      e.b += b * imgWeight;
      e.n += imgWeight;
      buckets.set(key, e);
    }
  }

  type Col = { r: number; g: number; b: number; weight: number };
  const cols: Col[] = [];
  for (const e of buckets.values()) {
    if (e.n <= 0) continue;
    const r = Math.round(e.r / e.n);
    const g = Math.round(e.g / e.n);
    const b = Math.round(e.b / e.n);
    const { s, l } = rgbToHsl(r, g, b);
    // Drop the obvious canvas/ink: near-white or near-black with no chroma.
    if (s < 0.08 && (l > 0.9 || l < 0.08)) continue;
    // Bias toward chromatic, mid-lightness colours (real brand colours) without
    // fully discarding muted tones.
    const satFactor = 0.12 + 0.88 * s;
    const lightFactor = Math.max(0.08, 1 - Math.pow(Math.abs(l - 0.5) * 2, 2.2) * 0.85);
    cols.push({ r, g, b, weight: e.n * satFactor * lightFactor });
  }
  cols.sort((a, b) => b.weight - a.weight);

  // Merge near-identical colours (keep the heavier, accumulate weight).
  const merged: Col[] = [];
  for (const c of cols) {
    const near = merged.find(
      (m) =>
        Math.sqrt((m.r - c.r) ** 2 + (m.g - c.g) ** 2 + (m.b - c.b) ** 2) < MERGE_DIST
    );
    if (near) {
      near.weight += c.weight;
      continue;
    }
    merged.push({ ...c });
    if (merged.length >= OUTPUT_LIMIT * 3) break;
  }
  merged.sort((a, b) => b.weight - a.weight);

  const top = merged.slice(0, OUTPUT_LIMIT);
  if (!top.length) return [];
  const maxW = top[0].weight || 1;
  // Normalise to 1–100 integer "counts" so it slots into the existing
  // count-weighted aggregation in computeDesign.
  return top.map((c) => ({
    hex: toHex(c.r, c.g, c.b),
    count: Math.max(1, Math.round((c.weight / maxW) * 100)),
  }));
}

/**
 * Resolve an email's mirrored content images (by storage path) and extract a
 * palette from them. Downloads, screens out tiny/blank/logo assets, and analyses
 * the largest few. Never throws — returns `[]` on any failure so it can't break
 * ingestion.
 */
export async function extractImagePaletteForEmail(
  storagePaths: string[]
): Promise<ImagePaletteColor[]> {
  if (!storagePaths?.length) return [];
  try {
    const admin = getSupabaseAdmin();
    const candidates: { bytes: Buffer; area: number }[] = [];

    for (const path of storagePaths.slice(0, MAX_DOWNLOADS)) {
      try {
        const { data, error } = await admin.storage
          .from(EMAIL_ASSETS_BUCKET)
          .download(path);
        if (error || !data) continue;
        const bytes = Buffer.from(await data.arrayBuffer());

        let meta: sharp.Metadata;
        try {
          meta = await sharp(bytes).metadata();
        } catch {
          continue;
        }
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;
        if (Math.min(w, h) < MIN_IMAGE_EDGE) continue; // spacer / icon
        if (await isImageBlank(bytes)) continue; // flat spacer / mono logo

        candidates.push({ bytes, area: w * h });
      } catch {
        continue;
      }
    }

    candidates.sort((a, b) => b.area - a.area);
    return await extractImagePaletteFromImages(candidates.slice(0, MAX_ANALYSED));
  } catch {
    return [];
  }
}
