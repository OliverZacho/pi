import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMAIL_CATEGORIES,
  type CategoryCountryFrequencyPoint,
  type CategoryFrequencyPoint,
  type DashboardStats,
  type EmailCategory,
  type FunnelStage,
  type GrowthPoint,
  type OnboardingMetrics,
  type OnboardingOutcomeRow,
  type SignupSourceStat,
  type TimeToFirstAction,
  type UpgradePromptStat,
  type UsageFeature,
  type UserGrowthPoint,
  type UserMetrics
} from "./admin-types";
import type { Database } from "@/types/supabase";
import { ONBOARDING_ROLE_LABELS, type OnboardingRole } from "./onboarding";
import { labelForUpgradeSource } from "./upgrade-clicks-db";
import { labelForSignupSource } from "./signup-source";

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

/**
 * Fetches the average send frequency per category for the dashboard chart via
 * the `pirol_admin_category_frequency` Postgres function.
 */
export async function getCategoryFrequency(
  supabase: PirolDb
): Promise<CategoryFrequencyPoint[]> {
  const { data, error } = await supabase.rpc("pirol_admin_category_frequency");
  if (error) {
    throw error;
  }
  return arr(data)
    .map((item) => {
      const o = obj(item);
      return {
        category: str(o.category),
        brands: num(o.brands),
        emailsPerWeek: num(o.emails_per_week),
        daysBetween: num(o.days_between)
      };
    })
    .filter((point) => point.category.length > 0);
}

/**
 * Fetches the average send frequency per (category, country) pair for the
 * dashboard chart via the `pirol_admin_category_country_frequency` Postgres
 * function.
 */
export async function getCategoryCountryFrequency(
  supabase: PirolDb
): Promise<CategoryCountryFrequencyPoint[]> {
  const { data, error } = await supabase.rpc("pirol_admin_category_country_frequency");
  if (error) {
    throw error;
  }
  return arr(data)
    .map((item) => {
      const o = obj(item);
      return {
        category: str(o.category),
        country: str(o.country),
        brands: num(o.brands),
        emailsPerWeek: num(o.emails_per_week),
        daysBetween: num(o.days_between)
      };
    })
    .filter((point) => point.category.length > 0 && point.country.length > 0);
}

/**
 * Fetches the audience-health rollup for the admin "Users" tab via the
 * `pirol_admin_user_metrics` Postgres function, then coerces the untyped JSON
 * into {@link UserMetrics}. Numbers can arrive as strings from Postgres, so
 * everything runs through {@link num}; rates stay nullable via {@link numOrNull}.
 */
export async function getUserMetrics(supabase: PirolDb): Promise<UserMetrics> {
  const { data, error } = await supabase.rpc("pirol_admin_user_metrics");
  if (error) {
    throw error;
  }
  return shapeUserMetrics(data);
}

function shapeUserMetrics(raw: unknown): UserMetrics {
  const root = obj(raw);
  const totals = obj(root.totals);
  const growth = obj(root.growth);
  const retention = obj(root.retention);
  const subscription = obj(root.subscription);
  const pmf = obj(root.pmf);
  const onboarding = obj(root.onboarding);

  return {
    generatedAt: str(root.generated_at),
    totals: {
      total: num(totals.total),
      free: num(totals.free),
      paid: num(totals.paid),
      admins: num(totals.admins)
    },
    growth: {
      new30d: num(growth.new_30d),
      newPrev30d: num(growth.new_prev_30d),
      growthRate30d: numOrNull(growth.growth_rate_30d),
      series: arr(growth.series)
        .map((item): UserGrowthPoint => {
          const o = obj(item);
          return { day: str(o.day), users: num(o.users), paid: num(o.paid) };
        })
        .filter((point) => point.day.length > 0)
    },
    retention: {
      realTotal: num(retention.real_total),
      onboarded: num(retention.onboarded),
      active7d: num(retention.active_7d),
      recent: num(retention.recent),
      atRisk: num(retention.at_risk),
      dormant: num(retention.dormant),
      neverOnboarded: num(retention.never_onboarded),
      inactiveRate30d: numOrNull(retention.inactive_rate_30d)
    },
    subscription: {
      active: num(subscription.active),
      canceled: num(subscription.canceled),
      churnRate: numOrNull(subscription.churn_rate)
    },
    pmf: {
      activated: num(pmf.activated),
      activationRate: numOrNull(pmf.activation_rate),
      powerUsers: num(pmf.power_users),
      powerUserRate: numOrNull(pmf.power_user_rate),
      dau: num(pmf.dau),
      wau: num(pmf.wau),
      mau: num(pmf.mau),
      stickiness: numOrNull(pmf.stickiness)
    },
    funnel: arr(root.funnel)
      .map((item): FunnelStage => {
        const o = obj(item);
        return { key: str(o.key), label: str(o.label), count: num(o.count) };
      })
      .filter((stage) => stage.key.length > 0),
    onboarding: shapeOnboarding(onboarding),
    timeToFirstAction: shapeTimeToFirstAction(obj(root.time_to_first_action)),
    upgradePrompts: arr(root.upgrade_prompts)
      .map((item): UpgradePromptStat => {
        const u = obj(item);
        const source = str(u.source);
        return {
          source,
          label: labelForUpgradeSource(source),
          clicks: num(u.clicks),
          clicks30d: num(u.clicks_30d),
          users: num(u.users),
          converted: num(u.converted),
          lastAt: typeof u.last_at === "string" ? u.last_at : null
        };
      })
      .filter((u) => u.source.length > 0),
    signupSources: arr(root.signup_sources)
      .map((item): SignupSourceStat => {
        const s = obj(item);
        const source = str(s.source);
        return {
          source,
          label: labelForSignupSource(source),
          total: num(s.total),
          last30d: num(s.last_30d),
          paid: num(s.paid)
        };
      })
      .filter((s) => s.source.length > 0)
  };
}

function shapeTimeToFirstAction(o: Record<string, unknown>): TimeToFirstAction {
  return {
    total: num(o.total),
    acted: num(o.acted),
    never: num(o.never),
    within1h: num(o.within_1h),
    within24h: num(o.within_24h),
    within7d: num(o.within_7d),
    later: num(o.later),
    medianMinutes: numOrNull(o.median_minutes),
    p75Minutes: numOrNull(o.p75_minutes)
  };
}

function shapeOnboarding(o: Record<string, unknown>): OnboardingMetrics {
  const bySteps = arr(o.skipped_by_step).map(num);
  return {
    since: str(o.since),
    total: num(o.total),
    pending: num(o.pending),
    completed: num(o.completed),
    skipped: num(o.skipped),
    completionRate: numOrNull(o.completion_rate),
    skippedByStep: [bySteps[0] ?? 0, bySteps[1] ?? 0, bySteps[2] ?? 0],
    ownBrand: num(o.own_brand),
    completedPaid: num(o.completed_paid),
    skippedPaid: num(o.skipped_paid),
    roles: arr(o.roles)
      .map((item) => {
        const r = obj(item);
        const role = str(r.role);
        return {
          role,
          label: ONBOARDING_ROLE_LABELS[role as OnboardingRole] ?? role,
          count: num(r.count)
        };
      })
      .filter((r) => r.role.length > 0),
    categories: arr(o.categories)
      .map((item) => {
        const c = obj(item);
        return { category: str(c.category), count: num(c.count) };
      })
      .filter((c) => c.category.length > 0),
    byOutcome: arr(o.by_outcome)
      .map((item) => {
        const r = obj(item);
        const outcome = str(r.outcome);
        return {
          outcome: outcome as OnboardingOutcomeRow["outcome"],
          total: num(r.total),
          acted: num(r.acted),
          savedAny: num(r.saved_any),
          followedLater: num(r.followed_later),
          madeCollection: num(r.made_collection),
          active7d: num(r.active_7d),
          paid: num(r.paid)
        };
      })
      .filter((r) => ["completed", "skipped", "pending"].includes(r.outcome)),
    requests: (() => {
      const r = obj(o.requests);
      return {
        total: num(r.total),
        pending: num(r.pending),
        handled: num(r.handled),
        users: num(r.users)
      };
    })()
  };
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

/** Like {@link num} but preserves a genuine null (used for nullable rates). */
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
