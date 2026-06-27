import type { PirolSupabaseClient } from "@/lib/supabase-admin";

/**
 * Click tracking for every "Upgrade" / "Subscribe" / "View plans" CTA.
 *
 * Each button passes a stable `source` tag so the admin dashboard can rank
 * which CTAs drive the most upgrade intent. Writes go through the service-role
 * client (so logged-out visitors count too); reads are admin-only.
 */

/** A human label for each known CTA source, shown in the admin dashboard. */
export const UPGRADE_SOURCE_LABELS: Record<string, string> = {
  brand_hero: "Brand page — hero button",
  brand_paywall: "Brand page — paywall card",
  explore_save_quota: "Explore — save limit reached",
  explore_paywall: "Explore — scroll paywall",
  sidebar_notice: "Sidebar — preview notice",
  settings_team_plan: "Settings — team invite notice",
  collection_share_team: "Collection — share with team (locked)",
  compare_share_team: "Comparison — share with team (locked)",
  settings_upgrade_plan: "Settings — billing upgrade",
  saved_quota: "Saved — save limit reached",
  locked_brand_stats: "Locked — brand stats",
  locked_compare: "Locked — comparisons",
  locked_collections: "Locked — collections",
  locked_brands: "Locked — brands",
  locked_following: "Locked — following",
  locked_saved: "Locked — saved"
};

/** Source tags must be lowercase snake/kebab, ≤ 48 chars — keeps the table tidy. */
const SOURCE_PATTERN = /^[a-z0-9_-]{1,48}$/;

export function isValidUpgradeSource(value: unknown): value is string {
  return typeof value === "string" && SOURCE_PATTERN.test(value);
}

/** Best-effort: turn a raw source tag into a readable label. */
export function labelForUpgradeSource(source: string): string {
  return UPGRADE_SOURCE_LABELS[source] ?? source;
}

export type UpgradeSourceStat = {
  source: string;
  label: string;
  total: number;
  last7: number;
  lastClickAt: string | null;
};

export type UpgradeClickStats = {
  total: number;
  total7: number;
  sources: UpgradeSourceStat[];
  /** Daily totals across the lookback window, oldest first. */
  daily: { date: string; count: number }[];
  windowDays: number;
};

/** Cap on rows scanned for the dashboard — generous, aggregation is in-JS. */
const STATS_ROW_CAP = 100_000;

/**
 * Aggregates clicks for the admin dashboard: per-source totals (all-time and
 * last 7 days) plus a daily time series across the lookback window.
 */
export async function getUpgradeClickStats(
  supabase: PirolSupabaseClient,
  options: { windowDays?: number; now?: Date } = {}
): Promise<UpgradeClickStats> {
  const windowDays = options.windowDays ?? 30;
  const now = options.now ?? new Date();
  const windowStart = new Date(now.getTime() - windowDays * 86_400_000);
  const sevenAgo = new Date(now.getTime() - 7 * 86_400_000);

  // All-time per-source counts + last click. Fetch the window for the time
  // series; for all-time totals we scan everything (capped).
  const { data, error } = await supabase
    .from("upgrade_clicks")
    .select("source, created_at")
    .order("created_at", { ascending: false })
    .limit(STATS_ROW_CAP);
  if (error) throw error;

  const rows = data ?? [];
  const bySource = new Map<
    string,
    { total: number; last7: number; lastClickAt: string | null }
  >();
  const dayBuckets = new Map<string, number>();

  let total = 0;
  let total7 = 0;
  for (const row of rows) {
    total += 1;
    const created = new Date(row.created_at);
    const isLast7 = created >= sevenAgo;
    if (isLast7) total7 += 1;

    const cur = bySource.get(row.source) ?? {
      total: 0,
      last7: 0,
      lastClickAt: null as string | null
    };
    cur.total += 1;
    if (isLast7) cur.last7 += 1;
    if (!cur.lastClickAt || row.created_at > cur.lastClickAt) {
      cur.lastClickAt = row.created_at;
    }
    bySource.set(row.source, cur);

    if (created >= windowStart) {
      const day = row.created_at.slice(0, 10);
      dayBuckets.set(day, (dayBuckets.get(day) ?? 0) + 1);
    }
  }

  const sources: UpgradeSourceStat[] = Array.from(bySource.entries())
    .map(([source, v]) => ({
      source,
      label: labelForUpgradeSource(source),
      total: v.total,
      last7: v.last7,
      lastClickAt: v.lastClickAt
    }))
    .sort((a, b) => b.total - a.total);

  // Build a dense daily series so the chart has no gaps.
  const daily: { date: string; count: number }[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    daily.push({ date: key, count: dayBuckets.get(key) ?? 0 });
  }

  return { total, total7, sources, daily, windowDays };
}
