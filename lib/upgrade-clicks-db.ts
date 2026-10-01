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
  follow_quota: "Follow — brand limit reached",
  collection_quota: "Collections — limit reached",
  comparison_quota: "Comparisons — limit reached",
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

/**
 * Aggregates clicks for the admin dashboard: per-source totals (all-time and
 * last 7 days) plus a daily time series across the lookback window. Counted
 * in SQL (upgrade_click_stats), so there's no row cap to outgrow.
 */
export async function getUpgradeClickStats(
  supabase: PirolSupabaseClient,
  options: { windowDays?: number; now?: Date } = {}
): Promise<UpgradeClickStats> {
  const windowDays = options.windowDays ?? 30;
  const now = options.now ?? new Date();
  const windowStart = new Date(now.getTime() - windowDays * 86_400_000);
  const sevenAgo = new Date(now.getTime() - 7 * 86_400_000);

  const { data, error } = await supabase.rpc("upgrade_click_stats", {
    p_recent_since: sevenAgo.toISOString(),
    p_daily_since: windowStart.toISOString()
  });
  if (error) throw error;

  const result = (data ?? { sources: [], daily: [] }) as unknown as {
    sources: {
      source: string;
      total: number;
      recent: number;
      last_click_at: string | null;
    }[];
    daily: { date: string; count: number }[];
  };

  let total = 0;
  let total7 = 0;
  const sources: UpgradeSourceStat[] = result.sources
    .map((row) => {
      total += row.total;
      total7 += row.recent;
      return {
        source: row.source,
        label: labelForUpgradeSource(row.source),
        total: row.total,
        last7: row.recent,
        lastClickAt: row.last_click_at
      };
    })
    .sort((a, b) => b.total - a.total);
  const dayBuckets = new Map(result.daily.map((d) => [d.date, d.count]));

  // Build a dense daily series so the chart has no gaps.
  const daily: { date: string; count: number }[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    daily.push({ date: key, count: dayBuckets.get(key) ?? 0 });
  }

  return { total, total7, sources, daily, windowDays };
}
