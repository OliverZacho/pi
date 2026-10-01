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

/**
 * Aggregates nav clicks for an admin readout: per-button totals (all-time and
 * last 7 days) plus the count of distinct signed-in users who clicked each.
 * Counted in SQL (nav_click_stats), so there's no row cap to outgrow.
 */
export async function getNavClickStats(
  supabase: PirolSupabaseClient,
  options: { now?: Date } = {}
): Promise<NavClickStats> {
  const now = options.now ?? new Date();
  const sevenAgo = new Date(now.getTime() - 7 * 86_400_000);

  const { data, error } = await supabase.rpc("nav_click_stats", {
    p_recent_since: sevenAgo.toISOString()
  });
  if (error) throw error;

  let total = 0;
  let total7 = 0;
  const items: NavClickStat[] = (data ?? [])
    .map((row) => {
      total += row.total;
      total7 += row.recent;
      return {
        navId: row.nav_id,
        label: labelForNavId(row.nav_id),
        total: row.total,
        last7: row.recent,
        uniqueUsers: row.unique_users,
        lastClickAt: row.last_click_at
      };
    })
    .sort((a, b) => b.total - a.total);

  return { total, total7, items, windowDays: 7 };
}
