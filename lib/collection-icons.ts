/**
 * Curated set of emoji a user can pick as their collection's icon.
 *
 * Deliberately *not* an open-ended emoji picker: the list is hand-picked
 * to read well as a small "board" glyph and to stay on-brand. We avoid
 * faces / smileys and other expressive emoji that look out of place next
 * to a collection name, and lean on objects, symbols and themes that map
 * naturally onto the kinds of things people group emails into (sales,
 * launches, inspiration, seasonal campaigns, …).
 *
 * Shared by the server (validation + persistence in `collections-db`) and
 * the client (the picker UI), so it lives in its own dependency-free
 * module rather than in either side's bundle.
 */
export const COLLECTION_ICONS = [
  "⭐",
  "🔥",
  "✨",
  "💡",
  "🎯",
  "🚀",
  "📌",
  "🏷️",
  "🛒",
  "🛍️",
  "🎁",
  "💎",
  "🏆",
  "📈",
  "💰",
  "❤️",
  "🎨",
  "📷",
  "🎉",
  "🌈",
  "☕",
  "🍀",
  "🔑",
  "🌿"
] as const;

export type CollectionIcon = (typeof COLLECTION_ICONS)[number];

const ICON_SET: ReadonlySet<string> = new Set(COLLECTION_ICONS);

/**
 * Narrowing guard used on both write paths (API input) and reads (a
 * hand-edited DB row). Anything outside the curated list is rejected so a
 * caller can't smuggle an arbitrary emoji — or arbitrary text — into the
 * column.
 */
export function isCollectionIcon(value: unknown): value is CollectionIcon {
  return typeof value === "string" && ICON_SET.has(value);
}
