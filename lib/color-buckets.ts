/**
 * Perceptual colour bucketing for the Explore colour filter.
 *
 * An email's palette (`metadata.image_palette`, or the HTML `palette_colors`
 * fallback) is a weighted list of `{ hex, count }`. Exact-hex matching is
 * useless for a filter — pixel palettes are continuous, so almost no two
 * emails share a hex. Instead we fold each colour into one of a small fixed
 * set of perceptual buckets (via HSL), accumulate the palette's weight per
 * bucket, and tag an email with a bucket only when that colour is *prominent*
 * — a real fraction of the whole palette. That way selecting a swatch surfaces
 * emails that genuinely lean into that colour (and its near neighbours),
 * rather than any email with a stray pixel of it.
 *
 * The buckets a row qualifies for are persisted to `captured_emails.color_buckets`
 * (a `text[]`, GIN-indexed) at ingest and by `scripts/backfill-color-buckets.ts`,
 * so the Explore query filters with a plain indexed array overlap.
 *
 * Pure and deterministic (hex maths only) — safe to import on the client for
 * the swatch UI as well as on the server for classification.
 */

export type ColorBucketKey =
  | "red"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "beige"
  | "black";

export type ColorBucket = {
  key: ColorBucketKey;
  label: string;
  /** Representative swatch shown in the filter UI. */
  swatch: string;
};

/**
 * The eight filterable colours, in display order. Two are deliberately not pure
 * hues: `beige` (warm low-saturation neutrals — cream / sand / tan, a dominant
 * catalogue aesthetic) and `black` (the monochrome dark greys / blacks that
 * otherwise carry no filterable colour). There is no dedicated orange: muted
 * warm tones fold into beige and saturated ones into red.
 */
export const COLOR_BUCKETS: ColorBucket[] = [
  { key: "red", label: "Red", swatch: "#d64545" },
  { key: "yellow", label: "Yellow", swatch: "#e6c34a" },
  { key: "green", label: "Green", swatch: "#4a9d5b" },
  { key: "blue", label: "Blue", swatch: "#3f6fb0" },
  { key: "purple", label: "Purple", swatch: "#8a5cb0" },
  { key: "pink", label: "Pink", swatch: "#d46a9f" },
  { key: "beige", label: "Beige", swatch: "#d8c4a0" },
  { key: "black", label: "Black", swatch: "#2e2e33" }
];

const BUCKET_KEYS = new Set<string>(COLOR_BUCKETS.map((b) => b.key));

/** True for a value that is one of the eight known bucket keys. */
export function isColorBucketKey(value: string): value is ColorBucketKey {
  return BUCKET_KEYS.has(value);
}

type PaletteEntry = { hex?: unknown; count?: unknown };

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const int = Number.parseInt(m[1], 16);
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff };
}

function rgbToHsl(
  r: number,
  g: number,
  b: number
): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

/**
 * Map a single hex to its bucket, or `null` when it carries no filterable
 * colour. Thin wrapper over {@link classifyRgb} for callers that hold a hex
 * string (stored palettes, the swatch UI).
 */
export function classifyHex(hex: string): ColorBucketKey | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return classifyRgb(rgb.r, rgb.g, rgb.b);
}

/**
 * Map a single RGB colour to its bucket, or `null` when it carries no
 * filterable colour (page white, or a light/mid grey). The order matters: the
 * two non-hue buckets — `beige` (warm, muted, light) and `black` (dark, near-
 * neutral) — are tested before the pure-hue ramp, since left to their hue
 * they would misfile as yellow/red or as a dark hue.
 *
 * Takes raw channels so the pixel-level classifier in `extract-image-palette`
 * can call it per pixel without round-tripping through a hex string.
 */
export function classifyRgb(r: number, g: number, b: number): ColorBucketKey | null {
  const { h, s, l } = rgbToHsl(r, g, b);

  // Paper / near-white canvas is not a colour.
  if (l >= 0.92) return null;
  // Near-black reads as black whatever faint tint it carries.
  if (l <= 0.1) return "black";

  // Beige / cream / sand / tan: warm hue, mid-to-high lightness, muted chroma.
  // The saturation ceiling is deliberately below a true tan so genuinely
  // colourful warm tones fall through to a hue bucket instead of diluting beige.
  if (h >= 20 && h <= 70 && l >= 0.55 && l <= 0.9 && s >= 0.1 && s <= 0.5) {
    return "beige";
  }

  // Black / charcoal / dark grey: dark and essentially achromatic. Kept to
  // low saturation so dark *browns* (which have real chroma) stay warm rather
  // than muddying the monochrome bucket.
  if (l <= 0.45 && s <= 0.2) return "black";

  // Anything left needs real chroma to count as a hue; otherwise it's a
  // light/mid grey — not one of our filters.
  if (s < 0.15) return null;

  // No orange bucket, and red stays true red/crimson. The red hue range also
  // covers brown — brown is just a dark, muted orange-red — so red additionally
  // requires real saturation and non-tiny lightness; that keeps crimson and
  // burgundy while dropping chocolate, coffee and taupe (low-saturation warms)
  // to no tag. The pure-orange band (≈18–48°) likewise has no home and drops
  // out here. Yellow is intentionally narrow.
  if (h < 18 || h >= 342) {
    return s >= 0.45 && l >= 0.22 && l <= 0.8 ? "red" : null;
  }
  if (h < 48) return null;
  if (h < 68) {
    // Strictly yellow: a vivid, mid-lightness yellow only. Washed-out or dark
    // yellow-greens (khaki, mustard, olive) are dropped rather than mislabelled.
    return s >= 0.4 && l >= 0.4 && l <= 0.75 ? "yellow" : null;
  }
  if (h < 170) return "green";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return "pink";
}

// A bucket qualifies when it owns at least this share of the palette's total
// Dominance model. The goal is "the dominant colour, plus one or two others
// only if they're clearly visible too" — never minor accents. So:
//  * the single strongest bucket is always kept, provided it occupies at least
//    MIN_TOP_SHARE of the whole email (otherwise the email is essentially
//    neutral and gets no colour tag);
//  * a second / third bucket is kept only if it owns a large share in its own
//    right (MIN_SECONDARY_SHARE) — a threshold high enough that a single accent
//    image can't clear it.
// Shares are measured against the whole palette (canvas colours included), so
// they track how much of the email the colour actually covers. There is no
// absolute-weight fallback: that used to promote a 17%-share accent purely
// because its raw count was high.
const MIN_TOP_SHARE = 0.15;
const MIN_SECONDARY_SHARE = 0.26;
const MAX_BUCKETS = 3;

/**
 * The dominance thresholds, as shares of the total weight:
 *  * `minTopShare` — the strongest bucket must own at least this much or the
 *    subject is treated as neutral (no colour tag at all);
 *  * `minSecondaryShare` — a second/third bucket is kept only if it owns at
 *    least this much in its own right;
 *  * `maxBuckets` — never tag more than this many colours.
 */
export type DominanceThresholds = {
  minTopShare: number;
  minSecondaryShare: number;
  maxBuckets: number;
};

const DEFAULT_DOMINANCE: DominanceThresholds = {
  minTopShare: MIN_TOP_SHARE,
  minSecondaryShare: MIN_SECONDARY_SHARE,
  maxBuckets: MAX_BUCKETS
};

/**
 * Reduce accumulated per-bucket weights to the dominant bucket(s) — one, or
 * two to three when each is clearly present — strongest first. `total` is the
 * denominator the shares are measured against; pass the *whole* weight (canvas
 * and untagged colours included) so a share reflects real coverage. Shared by
 * the stored-palette classifier here and the pixel-area classifier in
 * `extract-image-palette`.
 */
export function dominantBuckets(
  weights: Map<ColorBucketKey, number>,
  total: number,
  thresholds: DominanceThresholds = DEFAULT_DOMINANCE
): ColorBucketKey[] {
  if (total <= 0 || weights.size === 0) return [];

  const ranked = Array.from(weights.entries()).sort((a, b) => b[1] - a[1]);

  const [topKey, topWeight] = ranked[0];
  // No colour is prominent enough to call this subject's own — leave it untagged.
  if (topWeight / total < thresholds.minTopShare) return [];

  const result: ColorBucketKey[] = [topKey];
  for (const [key, weight] of ranked.slice(1)) {
    if (result.length >= thresholds.maxBuckets) break;
    // Ranked descending, so the first secondary below the bar means the rest
    // are too.
    if (weight / total < thresholds.minSecondaryShare) break;
    result.push(key);
  }
  return result;
}

/**
 * Reduce a weighted palette to its dominant colour bucket(s) — one, or two to
 * three when they're each clearly present — strongest first. Accepts the raw
 * JSON shape stored on `metadata.image_palette` / `metadata.palette_colors` so
 * callers can pass it straight through without reshaping.
 */
export function classifyPaletteBuckets(palette: unknown): ColorBucketKey[] {
  if (!Array.isArray(palette) || palette.length === 0) return [];

  const weights = new Map<ColorBucketKey, number>();
  let total = 0;

  for (const raw of palette as PaletteEntry[]) {
    const hex = typeof raw?.hex === "string" ? raw.hex : null;
    const count =
      typeof raw?.count === "number" && Number.isFinite(raw.count)
        ? Math.max(0, raw.count)
        : 0;
    if (!hex || count <= 0) continue;
    // Divide against the whole palette — canvas colours included — so a share
    // reflects how much of the email the colour actually covers.
    total += count;
    const bucket = classifyHex(hex);
    if (!bucket) continue;
    weights.set(bucket, (weights.get(bucket) ?? 0) + count);
  }

  return dominantBuckets(weights, total);
}
