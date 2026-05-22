/**
 * Selects a single "brand-representative" accent color from a brand's
 * extracted email color palette. Used to tint stats and graphs across
 * the brand dashboard so the page subtly reflects the brand's identity
 * instead of always rendering in neutral navy.
 *
 * The picker is intentionally opinionated:
 *
 *   - Anything in the lightest 15 % of the lightness range is
 *     skipped. Most newsletter palettes are dominated by white and
 *     cream backgrounds; using one as the accent would erase the
 *     visualisation against the dashboard's white card surface, even
 *     when the underlying hue is technically saturated.
 *   - Near-blacks are skipped. They're indistinguishable from the
 *     default chart color and offer no identity signal.
 *   - Greys (low saturation) are skipped. Same reasoning — they don't
 *     read as a brand color.
 *   - Washed-out pastels are skipped. A pale lavender or peach
 *     wouldn't carry enough visual weight in a chart fill.
 *
 * If no palette entry survives the filters, we fall back to the
 * dashboard's existing dark-navy default so the page never regresses.
 */
export type BrandAccent = {
  /** The picked hex color, lowercased (e.g. `#2563eb`). */
  base: string;
  /**
   * Text color to use *on top of* `base`. Picked dynamically from
   * relative luminance so white text is used on dark accents and dark
   * text is used on light accents — preserves legibility regardless of
   * which brand we're rendering.
   */
  foreground: string;
  /**
   * A low-alpha RGBA derived from `base`, suitable for tinted icon
   * backgrounds and hover states. Done as `rgba()` rather than
   * `color-mix()` so the value renders identically across the older
   * browsers our analytics page still supports.
   */
  soft: string;
};

const DEFAULT_ACCENT: BrandAccent = {
  base: "#0f172a",
  foreground: "#ffffff",
  soft: "rgba(15, 23, 42, 0.08)"
};

export function pickBrandAccent(
  palette: ReadonlyArray<{ hex: string; count: number }>
): BrandAccent {
  for (const entry of palette) {
    const analysis = analyseHex(entry.hex);
    if (!analysis) continue;

    if (analysis.l > 0.85) continue;
    if (analysis.l < 0.08) continue;
    if (analysis.s < 0.15) continue;
    // Light pastels (e.g. powder pink, pale peach) — too washed-out to
    // read as a brand color on a white card surface.
    if (analysis.l > 0.75 && analysis.s < 0.55) continue;

    return buildAccent(entry.hex, analysis.r, analysis.g, analysis.b);
  }
  return DEFAULT_ACCENT;
}

export function defaultBrandAccent(): BrandAccent {
  return DEFAULT_ACCENT;
}

function buildAccent(
  hex: string,
  r: number,
  g: number,
  b: number
): BrandAccent {
  const luminance = relativeLuminance(r, g, b);
  // 0.55 sits roughly at the WCAG perceived-brightness midpoint we get
  // from the standard sRGB luminance formula; everything above feels
  // visually "light" (yellows, light blues) and needs dark text.
  return {
    base: hex.toLowerCase(),
    foreground: luminance > 0.55 ? "#0f172a" : "#ffffff",
    soft: `rgba(${r}, ${g}, ${b}, 0.12)`
  };
}

function analyseHex(hex: string):
  | { r: number; g: number; b: number; s: number; l: number }
  | null {
  const match = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return null;
  const n = parseInt(match[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const { s, l } = rgbToHsl(r, g, b);
  return { r, g, b, s, l };
}

function rgbToHsl(r: number, g: number, b: number): { s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  return { s, l };
}

function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (c: number) => {
    const cn = c / 255;
    return cn <= 0.03928 ? cn / 12.92 : Math.pow((cn + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
