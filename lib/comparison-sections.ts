/**
 * Registry + preference plumbing for the comparison dashboard's
 * customizable sections.
 *
 * Users can hide a section (it collapses to a title bar) and reorder
 * sections to match what they care about. The layout is stored per
 * user in `user_prefs` under {@link COMPARE_SECTIONS_PREF_KEY} and
 * applied server-side so the dashboard renders in the saved layout on
 * first paint — no client-side reshuffle flash.
 *
 * Client-safe: no Supabase imports, just the id registry and the
 * sanitizer shared by the API route, the server pages and the client
 * rail component.
 */

export const COMPARE_SECTIONS_PREF_KEY = "compare_sections";

/**
 * One entry per dashboard section, in the default display order.
 * `title` is what the collapsed bar shows — keep these in sync with
 * the section headings in `CompareDashboard.tsx`.
 */
export const COMPARE_SECTIONS = [
  { id: "kpis", title: "KPI matrix" },
  { id: "rhythm", title: "Who sends the most" },
  { id: "cadence", title: "Send frequency over time" },
  { id: "forecast", title: "Predicted inbox crowding" },
  { id: "send-times", title: "When they send" },
  { id: "promo", title: "Discount aggressiveness" },
  { id: "occasions", title: "Seasonal moments they activate" },
  { id: "fingerprint", title: "Creative fingerprint" },
  { id: "content-mix", title: "What they talk about" },
  { id: "recent", title: "Latest campaigns" }
] as const;

export type CompareSectionId = (typeof COMPARE_SECTIONS)[number]["id"];

export type CompareSectionPrefs = {
  /** Full display order — always contains every known section id. */
  order: CompareSectionId[];
  /** Sections collapsed to their title bar. */
  hidden: CompareSectionId[];
};

const DEFAULT_ORDER = COMPARE_SECTIONS.map((s) => s.id);
const KNOWN_IDS = new Set<string>(DEFAULT_ORDER);

export function defaultCompareSectionPrefs(): CompareSectionPrefs {
  return { order: [...DEFAULT_ORDER], hidden: [] };
}

export function sectionTitle(id: CompareSectionId): string {
  return COMPARE_SECTIONS.find((s) => s.id === id)?.title ?? id;
}

/**
 * Turns whatever is stored (or PUT by a client) into a valid pref
 * object: unknown ids are dropped, duplicates collapse, and sections
 * missing from a stale saved order — e.g. ones shipped after the user
 * last saved — are inserted at their default position instead of
 * silently disappearing.
 *
 * Clients always send the complete order, so the default-position
 * backfill is tuned for the "new section shipped since last save"
 * case; a deliberately sparse payload is backfilled the same way and
 * makes no relative-order promises beyond containing every section.
 */
export function sanitizeCompareSectionPrefs(
  value: unknown
): CompareSectionPrefs {
  const raw =
    value && typeof value === "object"
      ? (value as { order?: unknown; hidden?: unknown })
      : {};

  const savedOrder = Array.isArray(raw.order) ? raw.order : [];
  const order: CompareSectionId[] = [];
  for (const id of savedOrder) {
    if (
      typeof id === "string" &&
      KNOWN_IDS.has(id) &&
      !order.includes(id as CompareSectionId)
    ) {
      order.push(id as CompareSectionId);
    }
  }
  for (const id of DEFAULT_ORDER) {
    if (!order.includes(id)) {
      const defaultIndex = DEFAULT_ORDER.indexOf(id);
      order.splice(Math.min(defaultIndex, order.length), 0, id);
    }
  }

  const savedHidden = Array.isArray(raw.hidden) ? raw.hidden : [];
  const hidden: CompareSectionId[] = [];
  for (const id of savedHidden) {
    if (
      typeof id === "string" &&
      KNOWN_IDS.has(id) &&
      !hidden.includes(id as CompareSectionId)
    ) {
      hidden.push(id as CompareSectionId);
    }
  }

  return { order, hidden };
}
