import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMAIL_CATEGORIES,
  type DashboardStats,
  type EmailCategory,
  type GrowthPoint,
  type UsageFeature
} from "./admin-types";
import type { Database } from "@/types/supabase";

type PirolDb = SupabaseClient<Database>;

const VALID_CATEGORIES = new Set<string>(EMAIL_CATEGORIES);
const VALID_FEATURES = new Set<UsageFeature>(["classify", "suggest", "hq_lookup", "vision"]);

/**
 * Fetches the admin dashboard rollup in a single round trip via the
 * `pirol_admin_dashboard_stats` Postgres function, then defensively coerces the
 * untyped JSON into {@link DashboardStats}. Postgres can hand numerics back as
 * strings, so every number runs through {@link num}.
 */
export async function getDashboardStats(supabase: PirolDb): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc("pirol_admin_dashboard_stats");
  if (error) {
    throw error;
  }
  return shapeStats(data);
}

/**
 * Fetches the cumulative emails/brands growth series for the dashboard chart
 * via the `pirol_admin_growth_series` Postgres function.
 */
export async function getGrowthSeries(supabase: PirolDb): Promise<GrowthPoint[]> {
  const { data, error } = await supabase.rpc("pirol_admin_growth_series");
  if (error) {
    throw error;
  }
  return arr(data)
    .map((item) => {
      const o = obj(item);
      return { day: str(o.day), emails: num(o.emails), brands: num(o.brands) };
    })
    .filter((point) => point.day.length > 0);
}

function shapeStats(raw: unknown): DashboardStats {
  const root = obj(raw);
  const totals = obj(root.totals);
  const velocity = obj(root.velocity);
  const brands = obj(root.brands);
  const discount = obj(root.discount);
  const quality = obj(root.quality);
  const cost = obj(root.cost);

  return {
    totals: {
      companies: num(totals.companies),
      emails: num(totals.emails)
    },
    velocity: {
      emails7d: num(velocity.emails_7d),
      emails30d: num(velocity.emails_30d)
    },
    brands: {
      total: num(brands.total),
      active30d: num(brands.active_30d),
      top: arr(brands.top)
        .map((item) => {
          const o = obj(item);
          return { name: str(o.name), count: num(o.count) };
        })
        .filter((item) => item.name.length > 0)
    },
    categories: arr(root.categories)
      .map((item) => {
        const o = obj(item);
        return { category: str(o.category), count: num(o.count) };
      })
      .filter((item): item is { category: EmailCategory; count: number } =>
        VALID_CATEGORIES.has(item.category)
      ),
    discount: {
      avgSaleDiscount:
        discount.avg_sale_discount === null || discount.avg_sale_discount === undefined
          ? null
          : num(discount.avg_sale_discount),
      saleCountWithDiscount: num(discount.sale_count_with_discount)
    },
    quality: {
      lowConfidenceThreshold: num(quality.low_confidence_threshold) || 0.5,
      brandsUnknownMarket: num(quality.brands_unknown_market),
      logosNeedingReview: num(quality.logos_needing_review),
      lowConfidenceEmails: num(quality.low_confidence_emails),
      unattributedEmails: num(quality.unattributed_emails)
    },
    cost: {
      totalUsd: num(cost.total_usd),
      totalCalls: num(cost.total_calls),
      last30dUsd: num(cost.last_30d_usd),
      inputTokens: num(cost.input_tokens),
      outputTokens: num(cost.output_tokens),
      cacheReadTokens: num(cost.cache_read_tokens),
      cacheCreationTokens: num(cost.cache_creation_tokens),
      webSearchRequests: num(cost.web_search_requests),
      trackingSince:
        typeof cost.tracking_since === "string" ? cost.tracking_since : null,
      byFeature: arr(cost.by_feature)
        .map((item) => {
          const o = obj(item);
          return { feature: str(o.feature), usd: num(o.usd), calls: num(o.calls) };
        })
        .filter((item): item is { feature: UsageFeature; usd: number; calls: number } =>
          VALID_FEATURES.has(item.feature as UsageFeature)
        ),
      byModel: arr(cost.by_model).map((item) => {
        const o = obj(item);
        return { model: str(o.model), usd: num(o.usd), calls: num(o.calls) };
      }),
      daily14d: arr(cost.daily_14d).map((item) => {
        const o = obj(item);
        return { day: str(o.day), usd: num(o.usd) };
      })
    }
  };
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
