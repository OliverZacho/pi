import type { PirolSupabaseClient } from "@/lib/supabase-admin";

/**
 * Click tracking for the primary left-panel nav buttons.
 *
 * Each button passes its stable `nav_id` so we can see which app surfaces
 * users actually explore. Writes go through the record_nav_click SECURITY
 * DEFINER function (see the migration); reads here are admin-only.
 */

/** A human label for each known nav id. Keep in sync with NAV_ITEMS. */
export const NAV_ID_LABELS: Record<string, string> = {
  explore: "Explore",
  saved: "Saved",
  brands: "Brands",
  following: "Following",
  collections: "Collections",
  compare: "Comparisons",
  "your-brand": "Your brand"
};

/** Nav ids must be lowercase snake/kebab, ≤ 48 chars — keeps the table tidy. */
const NAV_ID_PATTERN = /^[a-z0-9_-]{1,48}$/;

export function isValidNavId(value: unknown): value is string {
  return typeof value === "string" && NAV_ID_PATTERN.test(value);
}

/** Best-effort: turn a raw nav id into a readable label. */
export function labelForNavId(navId: string): string {
  return NAV_ID_LABELS[navId] ?? navId;
}

export type NavClickStat = {
  navId: string;
  label: string;
  total: number;
  last7: number;
  uniqueUsers: number;
  lastClickAt: string | null;
};

export type NavClickStats = {
  total: number;
  total7: number;
  items: NavClickStat[];
  windowDays: number;
};

/** Cap on rows scanned for the dashboard — generous, aggregation is in-JS. */
const STATS_ROW_CAP = 100_000;

/**
 * Aggregates nav clicks for an admin readout: per-button totals (all-time and
 * last 7 days) plus the count of distinct signed-in users who clicked each.
 */
export async function getNavClickStats(
  supabase: PirolSupabaseClient,
  options: { now?: Date } = {}
): Promise<NavClickStats> {
  const now = options.now ?? new Date();
  const sevenAgo = new Date(now.getTime() - 7 * 86_400_000);

  const { data, error } = await supabase
    .from("nav_clicks")
    .select("nav_id, user_id, created_at")
    .order("created_at", { ascending: false })
    .limit(STATS_ROW_CAP);
  if (error) throw error;

  const rows = data ?? [];
  const byNav = new Map<
    string,
    {
      total: number;
      last7: number;
      users: Set<string>;
      lastClickAt: string | null;
    }
  >();

  let total = 0;
  let total7 = 0;
  for (const row of rows) {
    total += 1;
    const isLast7 = new Date(row.created_at) >= sevenAgo;
    if (isLast7) total7 += 1;

    const cur = byNav.get(row.nav_id) ?? {
      total: 0,
      last7: 0,
      users: new Set<string>(),
      lastClickAt: null as string | null
    };
    cur.total += 1;
    if (isLast7) cur.last7 += 1;
    if (row.user_id) cur.users.add(row.user_id);
    if (!cur.lastClickAt || row.created_at > cur.lastClickAt) {
      cur.lastClickAt = row.created_at;
    }
    byNav.set(row.nav_id, cur);
  }

  const items: NavClickStat[] = Array.from(byNav.entries())
    .map(([navId, v]) => ({
      navId,
      label: labelForNavId(navId),
      total: v.total,
      last7: v.last7,
      uniqueUsers: v.users.size,
      lastClickAt: v.lastClickAt
    }))
    .sort((a, b) => b.total - a.total);

  return { total, total7, items, windowDays: 7 };
}
