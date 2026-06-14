/**
 * Web-safe / system fallback fonts that show up as a declaration's "primary"
 * font in boilerplate stacks (`font-family: Arial, sans-serif`) but don't
 * represent a brand's chosen typeface. We filter these out when surfacing a
 * brand's fonts so the real custom faces (e.g. "KHTeka", "Söhne") show through —
 * falling back to the unfiltered list if a brand only uses web-safe fonts.
 */
const GENERIC_FONTS = new Set(
  [
    "arial",
    "arialmt",
    "helvetica",
    "helveticaneue",
    "times",
    "timesnewroman",
    "georgia",
    "verdana",
    "tahoma",
    "trebuchetms",
    "courier",
    "couriernew",
    "ubuntu",
    "roboto",
    "segoeui",
    "systemui",
    "applesystem",
    "sansserif",
    "serif",
    "monospace",
    "inherit",
    "initial",
  ].map((s) => s)
);

export function isGenericFont(family: string): boolean {
  const key = family.toLowerCase().replace(/[^a-z0-9]/g, "");
  return GENERIC_FONTS.has(key);
}

/** Keep only real (non-generic) brand fonts; fall back to the raw list if none. */
export function pickBrandFonts<T extends { family: string }>(
  fonts: T[],
  limit: number
): T[] {
  const real = fonts.filter((f) => !isGenericFont(f.family));
  return (real.length > 0 ? real : fonts).slice(0, limit);
}
