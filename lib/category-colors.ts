import { type EmailCategory } from "./admin-types";

/**
 * Stable, hand-picked hex color for each campaign category. Kept as a
 * single source of truth so the brand dashboard heatmap, the legend
 * beneath it, and any future per-category UI all agree on the same hue.
 *
 * The palette is tuned to look balanced when several swatches sit next
 * to each other in the legend, and to remain legible on the off-white
 * dashboard background. Hues were picked from the Tailwind 500 ramp so
 * they read as "modern SaaS" rather than ad-hoc.
 */
export const CATEGORY_COLORS: Record<EmailCategory, string> = {
  sale: "#f59e0b",
  product_launch: "#6366f1",
  products: "#3b82f6",
  event: "#ec4899",
  content: "#10b981",
  education: "#06b6d4",
  loyalty: "#8b5cf6",
  welcome: "#14b8a6",
  seasonal: "#ef4444",
  partnership: "#f97316",
  company_news: "#475569",
  survey: "#84cc16",
  other: "#a1a1aa"
};

/**
 * Looks up the color for a category id. Falls back to the neutral
 * "other" swatch for any unknown or legacy string so the heatmap never
 * renders an uncolored cell when an email has data attached.
 */
export function colorForCategory(category: string): string {
  return (
    CATEGORY_COLORS[category as EmailCategory] ?? CATEGORY_COLORS.other
  );
}
