/**
 * Prettifies a raw `companies.markets` tag ("home_design", "baby-kids") into
 * a display label ("Home Design", "Baby Kids"). The tags are free-form
 * lowercase slugs supplied at brand-creation time, so display casing is a
 * pure presentation concern — the raw slug stays the canonical value
 * everywhere (filters, storage, matching).
 */
export function formatMarketLabel(market: string): string {
  const trimmed = market.trim();
  if (!trimmed) return market;
  return trimmed
    .split(/[\s_-]+/)
    .map((word) =>
      word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)
    )
    .join(" ");
}
