/**
 * Categorical colour palette used to distinguish brands inside the
 * comparison dashboard.
 *
 * The compare flow can host up to {@link MAX_BRANDS_PER_COMPARISON}
 * brands at a time. Brand accent colours are great per-brand identity
 * cues but they routinely collide when a cohort has, say, three
 * navy-heavy fashion labels next to two charcoal furniture brands —
 * the chart legend stops being scannable. So the dashboard tints
 * every chart series with a high-contrast categorical palette
 * (loosely inspired by d3's `schemeTableau10`, extended to 20) instead
 * of the brand accent, while the brand chips / KPI accents elsewhere
 * still use the natural brand colour.
 *
 * Colours are deliberately spaced around the hue wheel and alternate
 * between saturated + slightly muted variants so adjacent brands in
 * a stacked bar read as distinct even on a white card surface.
 */
export const COMPARE_COLOR_PALETTE: ReadonlyArray<string> = [
  "#4f46e5", // indigo
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#f97316", // orange
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#84cc16", // lime
  "#a855f7", // purple
  "#22c55e", // green
  "#eab308", // yellow
  "#3b82f6", // blue
  "#d946ef", // fuchsia
  "#f43f5e", // rose
  "#0891b2", // dark cyan
  "#65a30d", // olive
  "#7c3aed" // deep violet
];

/**
 * Stable per-brand colour for chart series. Wraps the palette so we
 * never index out of bounds even if a caller exceeds the comparison
 * cap (defensive, not expected).
 */
export function getCompareColor(index: number): string {
  if (index < 0) return COMPARE_COLOR_PALETTE[0];
  return COMPARE_COLOR_PALETTE[index % COMPARE_COLOR_PALETTE.length];
}

/**
 * Neutral colour used for the aggregated rollup row in the heatmap
 * + the total line in tooltips. Picked dark enough to read above any
 * per-brand colour without dominating the chart palette.
 */
export const COMPARE_AGGREGATE_COLOR = "#0f172a";
