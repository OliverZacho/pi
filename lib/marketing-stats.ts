import { createClient } from "@supabase/supabase-js";

/**
 * Live archive numbers for the marketing site, fetched via the
 * marketing_archive_stats() RPC (SECURITY DEFINER, anon-executable) so
 * the landing page can stay statically revalidated — no cookies, no
 * service key.
 */
export type ArchiveStats = {
  emails30d: number;
  brandsActive30d: number;
  discounts30d: number;
  deadlines30d: number;
  brandsTotal: number;
};

// DB snapshot from 2026-07-30, shown only if the stats RPC is unreachable.
const FALLBACK_STATS: ArchiveStats = {
  emails30d: 2296,
  brandsActive30d: 405,
  discounts30d: 716,
  deadlines30d: 280,
  brandsTotal: 530
};

export async function getArchiveStats(): Promise<ArchiveStats> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) return FALLBACK_STATS;

  try {
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await supabase.rpc("marketing_archive_stats");
    if (error || !data) return FALLBACK_STATS;

    return {
      emails30d: data.emails_30d ?? FALLBACK_STATS.emails30d,
      brandsActive30d: data.brands_active_30d ?? FALLBACK_STATS.brandsActive30d,
      discounts30d: data.discounts_30d ?? FALLBACK_STATS.discounts30d,
      deadlines30d: data.deadlines_30d ?? FALLBACK_STATS.deadlines30d,
      brandsTotal: data.brands_total ?? FALLBACK_STATS.brandsTotal
    };
  } catch {
    return FALLBACK_STATS;
  }
}
