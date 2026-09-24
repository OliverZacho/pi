/**
 * Loads {@link BrandClaimFacts} and its category benchmark out of the DB views
 * added in 20260924120000_brand_claim_facts.sql, and builds the narrative.
 *
 * All the aggregation lives in Postgres (`brand_campaign_stats`,
 * `brand_benchmark_pool`, `brand_category_benchmarks`), so a brand page render
 * costs two round trips of keyed lookups rather than a percentile scan across
 * the whole category. That matters because this path is what Googlebot hits.
 *
 * Read through the service-role client by the caller: logged-out visitors and
 * crawlers have no RLS grant on `captured_emails`, and they are precisely who
 * reads the public summary.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildBrandNarrative,
  NARRATIVE_MIN_CAMPAIGNS,
  type BrandClaimFacts,
  type BrandNarrative,
  type CategoryBenchmark
} from "./brand-claims";
import type { EmailCategory } from "./admin-types";

/** Row shape of `public.brand_campaign_stats`. */
type StatsRow = {
  campaigns: number;
  zone_label: string | null;
  first_send: string | null;
  span_days: number;
  send_days: number;
  distinct_subjects: number;
  discount_count: number;
  max_discount: number | string | null;
  max_discount_at: string | null;
  discount_depths: (number | string)[] | null;
  promo_code_count: number;
  deadline_count: number;
  extension_count: number;
  esp: string | null;
  padded_share: number | null;
  dark_share: number | null;
  gif_share: number | null;
  hour_counts: Record<string, number> | null;
  weekday_counts: Record<string, number> | null;
  mix: Record<string, number> | null;
};

type PoolRow = { category: string; rank_per_week: number | null };

type BenchmarkRow = {
  category: string;
  brands: number;
  median_per_week: number | null;
  p90_per_week: number | null;
  median_discount_share: number | null;
  median_max_discount: number | null;
  share_that_discount: number | null;
};

/**
 * Expands a sparse jsonb histogram ({"9": 49}) into a dense array the claim
 * engine can index by position. Unknown or out-of-range keys are ignored rather
 * than throwing: a malformed histogram should cost us one claim, not the page.
 */
function densify(
  counts: Record<string, number> | null,
  length: number
): number[] {
  const dense = Array<number>(length).fill(0);
  for (const [key, value] of Object.entries(counts ?? {})) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= length) continue;
    dense[index] = Number(value) || 0;
  }
  return dense;
}

/** Postgres numerics arrive as strings over PostgREST. */
function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Builds the public narrative for one brand, or null when there is not enough
 * data to say anything distinctive (see `NARRATIVE_MIN_CAMPAIGNS`). Callers
 * must fall back to the one-sentence `buildBrandSummary` in that case.
 *
 * Never throws: a failure here degrades the page to its existing summary rather
 * than taking the brand page down.
 */
export async function getBrandNarrative(
  admin: SupabaseClient,
  companyId: string,
  options: { name: string }
): Promise<BrandNarrative | null> {
  try {
    const [statsResult, poolResult, companyResult] = await Promise.all([
      admin
        .from("brand_campaign_stats")
        .select(
          "campaigns, zone_label, first_send, span_days, send_days, distinct_subjects, discount_count, max_discount, max_discount_at, discount_depths, promo_code_count, deadline_count, extension_count, esp, padded_share, dark_share, gif_share, hour_counts, weekday_counts, mix"
        )
        .eq("company_id", companyId)
        .maybeSingle(),
      admin
        .from("brand_benchmark_pool")
        .select("category, rank_per_week")
        .eq("company_id", companyId)
        .maybeSingle(),
      admin
        .from("companies")
        .select("slug, markets")
        .eq("id", companyId)
        .maybeSingle()
    ]);

    const stats = statsResult.data as StatsRow | null;
    const pool = poolResult.data as PoolRow | null;
    const company = companyResult.data as {
      slug: string;
      markets: string[] | null;
    } | null;

    if (!stats || !company || stats.campaigns <= 0) return null;

    // Bail before the benchmark round trip for brands that can never get a
    // narrative. `buildBrandNarrative` enforces this floor too, but for the ~40%
    // of the catalogue below it there is no point paying for the category row.
    if (stats.campaigns < NARRATIVE_MIN_CAMPAIGNS) return null;

    // The pool row is authoritative for category when present (it is what the
    // rank was computed against); otherwise fall back to the primary market tag,
    // which is the same expression the pool uses.
    const category = pool?.category ?? company.markets?.[0] ?? null;

    const facts: BrandClaimFacts = {
      slug: company.slug,
      name: options.name,
      category,
      campaigns: stats.campaigns,
      spanDays: Math.max(stats.span_days, 1),
      sendDays: stats.send_days,
      perWeek: (stats.campaigns / Math.max(stats.span_days, 1)) * 7,
      distinctSubjects: stats.distinct_subjects,
      mix: Object.entries(stats.mix ?? {})
        .map(([key, count]) => ({
          category: key as EmailCategory,
          count: Number(count) || 0
        }))
        .sort((a, b) => b.count - a.count),
      weekdayCounts: densify(stats.weekday_counts, 7),
      hourCounts: densify(stats.hour_counts, 24),
      timezoneLabel: stats.zone_label ?? "UTC",
      discountCount: stats.discount_count,
      discountDepths: (stats.discount_depths ?? [])
        .map((d) => toNumber(d))
        .filter((d): d is number => d !== null)
        .sort((a, b) => a - b),
      maxDiscount: toNumber(stats.max_discount),
      maxDiscountAt: stats.max_discount_at,
      promoCodeCount: stats.promo_code_count,
      deadlineCount: stats.deadline_count,
      extensionCount: stats.extension_count,
      esp: stats.esp,
      paddedShare: stats.padded_share ?? 0,
      darkShare: stats.dark_share ?? 0,
      gifShare: stats.gif_share ?? 0,
      firstSend: stats.first_send
    };

    // Only fetch the category row once we know the brand clears the narrative
    // floor — for the ~40% of brands that do not, this saves a round trip.
    let benchmark: CategoryBenchmark | null = null;
    if (category) {
      const { data } = await admin
        .from("brand_category_benchmarks")
        .select(
          "category, brands, median_per_week, p90_per_week, median_discount_share, median_max_discount, share_that_discount"
        )
        .eq("category", category)
        .maybeSingle();
      const row = data as BenchmarkRow | null;
      if (row) {
        benchmark = {
          category: row.category,
          brands: row.brands,
          medianPerWeek: row.median_per_week ?? 0,
          p90PerWeek: row.p90_per_week ?? 0,
          rankPerWeek: pool?.rank_per_week ?? null,
          medianDiscountShare: row.median_discount_share ?? 0,
          medianMaxDiscount: row.median_max_discount ?? null,
          shareThatDiscount: row.share_that_discount ?? 0
        };
      }
    }

    return buildBrandNarrative(facts, benchmark);
  } catch (err) {
    console.error("getBrandNarrative failed", { companyId, err });
    return null;
  }
}
