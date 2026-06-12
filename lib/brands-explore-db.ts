import type { SupabaseClient } from "@supabase/supabase-js";
import { ESP_LABELS, type EspProvider } from "./admin-types";
import { BRAND_LOGO_TRANSFORM, getSignedAssets } from "./storage";
import type { Database } from "@/types/supabase";

/**
 * Single row in the Brands grid. Cards stay deliberately minimal — the
 * heavy stats live on the per-brand dashboard (`/brands/[id]`) and we
 * only expose what's directly filterable from this page (market, ESP,
 * send cadence) so the visual layer doesn't drown the user in numbers.
 */
export type BrandsExploreCard = {
  id: string;
  name: string;
  /**
   * Raw market slugs (e.g. `["home_design", "ecommerce"]`). The UI
   * prettifies for display. Empty array when the brand is uncategorised.
   * A brand can sit in multiple markets at once — the explore filter
   * uses an array overlap so picking any one of these tags will surface
   * the brand.
   */
  markets: string[];
  logoUrl: string | null;
  /**
   * The brand's rolled-up primary audience country (ISO 3166-1 alpha-2),
   * or `null` when unknown. Lets the explorer / compare picker show and
   * filter by region so peers can be kept same-market.
   */
  primaryMarketCountry: string | null;
  /** True for genuine global brands (Nike, LEGO); they still carry an HQ country. */
  isGlobal: boolean;
  /**
   * Primary email-service provider this brand sends with, derived from
   * the modal ESP across captured emails. `null` when we have not
   * detected an ESP on any captured message yet.
   */
  primaryEsp: { id: EspProvider; label: string } | null;
  /**
   * Mean days between consecutive sends, computed from the captured
   * `received_at` timeline. `null` when we have fewer than two emails
   * to derive a delta from.
   */
  avgDaysBetween: number | null;
  /**
   * ISO timestamp of the most recent captured send, or `null` when we
   * have no emails for the brand yet. Drives the card's "last send" /
   * active-recency signal.
   */
  lastEmailAt: string | null;
  /** ISO timestamp of when we first started tracking this brand. */
  subscribedSince: string;
};

export type BrandsSortKey =
  | "most_active"
  | "recently_active"
  | "recently_added"
  | "name_asc"
  | "name_desc";

/** Activity windows expressed in days. Backed by `last_received_at`. */
export type BrandsActivityWindow = "30d" | "90d" | "180d" | "inactive";

export type BrandsSearchParams = {
  query?: string;
  markets?: string[];
  /** ISO 3166-1 alpha-2 country to restrict to (the brand's primary market). */
  country?: string | null;
  /** Restrict to global brands only (mutually exclusive with `country` in the UI). */
  global?: boolean;
  espProviders?: EspProvider[];
  /**
   * Inclusive cadence window in days. Either bound can be null to mean
   * "no constraint at that end". Brands without enough data to compute
   * a cadence are excluded whenever any bound is set.
   */
  cadenceMinDays?: number | null;
  cadenceMaxDays?: number | null;
  activity?: BrandsActivityWindow | null;
  minEmailCount?: number | null;
  hasLogo?: boolean;
  subscribedAfter?: string | null;
  subscribedBefore?: string | null;
  sort?: BrandsSortKey;
  page?: number;
  pageSize?: number;
};

export type BrandsSearchResult = {
  items: BrandsExploreCard[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type BrandsFacets = {
  markets: string[];
  /**
   * Distinct primary-market countries (ISO 3166-1 alpha-2) present across
   * tracked brands, sorted alphabetically. Powers the region filter; brands
   * of unknown region contribute nothing here.
   */
  countries: string[];
  espProviders: { id: EspProvider; label: string }[];
  /**
   * Observed upper bound for the cadence slider. Computed from real
   * brand data and rounded up so the slider has a tidy max even if
   * one outlier sends every 27.3 days. Always >= `CADENCE_MIN_MAX`
   * so the slider is never a single point.
   */
  cadenceMaxDays: number;
  totalBrands: number;
  brandsWithEmails: number;
};

export const BRANDS_PAGE_SIZE = 36;
const MAX_PAGE_SIZE = 96;

/**
 * Cap on captured-email rows pulled in for the per-brand aggregation
 * pass. We only need (company_id, received_at, esp_provider) so each
 * row is tiny; 20k rows is comfortably in the dozens of milliseconds
 * to fetch + aggregate even for the largest dataset we expect.
 *
 * When dataset growth pushes us past this, the right move is a
 * Postgres view (or materialised view) that pre-computes one row per
 * brand with `primary_esp`, `avg_days_between`, etc.; the function
 * shape here would not change.
 */
const BRAND_AGG_ROW_CAP = 20_000;

/** Smallest acceptable upper bound for the cadence slider, in days. */
const CADENCE_MIN_MAX = 7;
/** Hard upper bound for the slider so a single outlier doesn't push it absurd. */
const CADENCE_HARD_MAX = 60;

type CompanyRow = {
  id: string;
  name: string;
  domain: string;
  markets: string[] | null;
  primary_market_country: string | null;
  is_global: boolean | null;
  subscribed_since: string;
  logo_storage_path: string | null;
  company_email_stats:
    | { email_count: number | null; last_received_at: string | null }
    | { email_count: number | null; last_received_at: string | null }[]
    | null;
};

type BrandAggregate = {
  primaryEsp: EspProvider | null;
  avgDaysBetween: number | null;
};

type AggregateResult = {
  perBrand: Map<string, BrandAggregate>;
  espIdsInUse: Set<EspProvider>;
  /** Observed maximum cadence across all brands, in days. */
  cadenceMaxObserved: number;
};

function relationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Server-side Brands search.
 *
 * Two-pass design:
 *  1. Pull non-deleted companies + the `company_email_stats` view (so
 *     activity / volume filters and sorts can run on cheap counters).
 *  2. Pull a slim slice of captured emails to derive per-brand ESP +
 *     cadence in JS. The aggregates are folded into each candidate
 *     row, then ESP / cadence filters are applied and pagination is
 *     finalised in memory.
 *
 * The in-memory finish keeps the code straightforward at the brand
 * counts we expect today (low hundreds). See {@link BRAND_AGG_ROW_CAP}
 * for the migration trigger.
 */
export async function searchBrands(
  supabase: SupabaseClient<Database>,
  params: BrandsSearchParams = {}
): Promise<BrandsSearchResult> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(params.pageSize ?? BRANDS_PAGE_SIZE))
  );
  const sort: BrandsSortKey = params.sort ?? "most_active";

  let query = supabase
    .from("companies")
    .select(
      "id, name, domain, markets, primary_market_country, is_global, subscribed_since, logo_storage_path, company_email_stats(email_count, last_received_at)"
    )
    .is("deleted_at", null);

  if (params.markets && params.markets.length > 0) {
    // `overlaps` matches any brand whose `markets` array shares at least
    // one tag with the user's selection — so a brand tagged
    // `["fashion", "ecommerce"]` is returned under both filters.
    query = query.overlaps("markets", params.markets);
  }

  if (params.global) {
    query = query.eq("is_global", true);
  } else if (params.country) {
    // Restrict to one audience so peer comparisons stay same-market. Brands
    // whose region we couldn't determine (NULL) are intentionally excluded
    // when a country filter is active.
    query = query.eq("primary_market_country", params.country);
  }

  const trimmedQuery = (params.query ?? "").trim();
  if (trimmedQuery.length > 0) {
    const sanitized = sanitizeIlikeTerm(trimmedQuery);
    if (sanitized.length > 0) {
      const term = `%${sanitized}%`;
      query = query.or(
        [`name.ilike.${term}`, `domain.ilike.${term}`].join(",")
      );
    }
  }

  if (params.hasLogo) {
    query = query.not("logo_storage_path", "is", null);
  }
  if (params.subscribedAfter) {
    query = query.gte("subscribed_since", params.subscribedAfter);
  }
  if (params.subscribedBefore) {
    query = query.lte("subscribed_since", params.subscribedBefore);
  }

  const { data, error } = await query;
  if (error) throw error;

  const now = Date.now();
  const windowMs: Record<Exclude<BrandsActivityWindow, "inactive">, number> = {
    "30d": 30 * 86_400_000,
    "90d": 90 * 86_400_000,
    "180d": 180 * 86_400_000
  };

  type EnrichedRow = CompanyRow & {
    emailCount: number;
    lastReceivedMs: number | null;
    subscribedMs: number;
    primaryEsp: EspProvider | null;
    avgDaysBetween: number | null;
  };

  // Aggregate per-brand ESP + cadence in a single email scan. The
  // function caches inside the request via `supabase`'s scope; if the
  // same client is reused across multiple searches (it isn't today)
  // the cost would still be a single fetch per call.
  const aggregates = await computeBrandAggregates(supabase);

  const enriched: EnrichedRow[] = (data ?? []).map((row) => {
    const stats = relationFirst(row.company_email_stats);
    const emailCount = stats?.email_count ?? 0;
    const lastReceivedMs = stats?.last_received_at
      ? new Date(stats.last_received_at).getTime()
      : null;
    const subscribedMs = new Date(row.subscribed_since).getTime();
    const agg = aggregates.perBrand.get(row.id);
    return {
      ...(row as CompanyRow),
      emailCount,
      lastReceivedMs:
        lastReceivedMs !== null && Number.isNaN(lastReceivedMs)
          ? null
          : lastReceivedMs,
      subscribedMs: Number.isNaN(subscribedMs) ? 0 : subscribedMs,
      primaryEsp: agg?.primaryEsp ?? null,
      avgDaysBetween: agg?.avgDaysBetween ?? null
    };
  });

  let filtered = enriched;
  if (typeof params.minEmailCount === "number" && params.minEmailCount > 0) {
    const min = Math.floor(params.minEmailCount);
    filtered = filtered.filter((row) => row.emailCount >= min);
  }
  if (params.activity) {
    if (params.activity === "inactive") {
      filtered = filtered.filter(
        (row) =>
          row.lastReceivedMs === null ||
          now - row.lastReceivedMs > windowMs["180d"]
      );
    } else {
      const max = windowMs[params.activity];
      filtered = filtered.filter(
        (row) =>
          row.lastReceivedMs !== null && now - row.lastReceivedMs <= max
      );
    }
  }
  if (params.espProviders && params.espProviders.length > 0) {
    const allowed = new Set<EspProvider>(params.espProviders);
    filtered = filtered.filter(
      (row) => row.primaryEsp !== null && allowed.has(row.primaryEsp)
    );
  }

  const cadenceMin =
    typeof params.cadenceMinDays === "number" && params.cadenceMinDays >= 0
      ? params.cadenceMinDays
      : null;
  const cadenceMax =
    typeof params.cadenceMaxDays === "number" && params.cadenceMaxDays >= 0
      ? params.cadenceMaxDays
      : null;
  if (cadenceMin !== null || cadenceMax !== null) {
    filtered = filtered.filter((row) => {
      if (row.avgDaysBetween === null) return false;
      if (cadenceMin !== null && row.avgDaysBetween < cadenceMin) return false;
      if (cadenceMax !== null && row.avgDaysBetween > cadenceMax) return false;
      return true;
    });
  }

  filtered.sort((a, b) => {
    switch (sort) {
      case "name_asc":
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      case "name_desc":
        return b.name.localeCompare(a.name, undefined, { sensitivity: "base" });
      case "recently_added":
        return b.subscribedMs - a.subscribedMs;
      case "recently_active": {
        const aLast = a.lastReceivedMs ?? 0;
        const bLast = b.lastReceivedMs ?? 0;
        if (aLast === bLast) return b.emailCount - a.emailCount;
        return bLast - aLast;
      }
      case "most_active":
      default: {
        if (a.emailCount === b.emailCount) {
          const aLast = a.lastReceivedMs ?? 0;
          const bLast = b.lastReceivedMs ?? 0;
          return bLast - aLast;
        }
        return b.emailCount - a.emailCount;
      }
    }
  });

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const slice = filtered.slice(start, end);

  const logoPaths = Array.from(
    new Set(
      slice
        .map((row) => row.logo_storage_path)
        .filter((p): p is string => Boolean(p))
    )
  );
  const signed =
    logoPaths.length > 0
      ? await getSignedAssets(logoPaths, { transform: BRAND_LOGO_TRANSFORM })
      : {};

  const items: BrandsExploreCard[] = slice.map((row) => {
    const logoUrl = row.logo_storage_path
      ? signed[row.logo_storage_path] ?? null
      : null;
    return {
      id: row.id,
      name: row.name,
      markets: Array.isArray(row.markets) ? row.markets : [],
      primaryMarketCountry: row.primary_market_country ?? null,
      isGlobal: row.is_global ?? false,
      logoUrl,
      primaryEsp: row.primaryEsp
        ? {
            id: row.primaryEsp,
            label: ESP_LABELS[row.primaryEsp] ?? row.primaryEsp
          }
        : null,
      avgDaysBetween: row.avgDaysBetween,
      lastEmailAt:
        row.lastReceivedMs !== null
          ? new Date(row.lastReceivedMs).toISOString()
          : null,
      subscribedSince: row.subscribed_since
    };
  });

  return {
    items,
    total,
    page,
    pageSize,
    hasMore: end < total
  };
}

/**
 * Walks captured emails (capped at {@link BRAND_AGG_ROW_CAP}) and
 * returns, for each brand, its modal ESP and the mean days between
 * sends. Returned alongside is the set of ESPs that appear at least
 * once and the largest observed cadence — both used by the facets
 * endpoint to seed the filter UI.
 */
export async function computeBrandAggregates(
  supabase: SupabaseClient<Database>,
  companyIds?: string[]
): Promise<AggregateResult> {
  let emailQuery = supabase
    .from("captured_emails")
    .select("company_id, received_at, esp_provider")
    .not("company_id", "is", null);

  // When the caller only needs a known set of brands (e.g. the user's
  // follow list), scope the sweep to those companies so we read a tiny
  // slice instead of the full capped window.
  if (companyIds && companyIds.length > 0) {
    emailQuery = emailQuery.in("company_id", companyIds);
  }

  const { data, error } = await emailQuery
    .order("received_at", { ascending: false })
    .limit(BRAND_AGG_ROW_CAP);

  if (error) throw error;

  type BrandBucket = {
    times: number[];
    esp: Map<EspProvider, number>;
  };
  const buckets = new Map<string, BrandBucket>();
  const espIdsInUse = new Set<EspProvider>();

  for (const row of data ?? []) {
    if (!row.company_id) continue;
    const t = new Date(row.received_at).getTime();
    if (Number.isNaN(t)) continue;
    let bucket = buckets.get(row.company_id);
    if (!bucket) {
      bucket = { times: [], esp: new Map() };
      buckets.set(row.company_id, bucket);
    }
    bucket.times.push(t);
    if (row.esp_provider) {
      const id = row.esp_provider as EspProvider;
      bucket.esp.set(id, (bucket.esp.get(id) ?? 0) + 1);
      espIdsInUse.add(id);
    }
  }

  const perBrand = new Map<string, BrandAggregate>();
  let cadenceMaxObserved = 0;

  for (const [brandId, bucket] of buckets) {
    let primaryEsp: EspProvider | null = null;
    let bestCount = 0;
    for (const [id, count] of bucket.esp) {
      if (count > bestCount) {
        bestCount = count;
        primaryEsp = id;
      }
    }

    let avgDaysBetween: number | null = null;
    if (bucket.times.length >= 2) {
      // Times come in descending order from the query above; sort
      // ascending so consecutive diffs are positive.
      const sorted = bucket.times.slice().sort((a, b) => a - b);
      let totalMs = 0;
      for (let i = 1; i < sorted.length; i++) {
        totalMs += sorted[i] - sorted[i - 1];
      }
      avgDaysBetween = totalMs / (sorted.length - 1) / 86_400_000;
      if (avgDaysBetween > cadenceMaxObserved) {
        cadenceMaxObserved = avgDaysBetween;
      }
    }

    perBrand.set(brandId, { primaryEsp, avgDaysBetween });
  }

  return { perBrand, espIdsInUse, cadenceMaxObserved };
}

/**
 * Lists every market slug currently in use, every ESP we have a
 * primary signal for, and a sensible upper bound for the cadence
 * slider. Used by the filter UI to seed its menus.
 */
export async function getBrandsFacets(
  supabase: SupabaseClient<Database>
): Promise<BrandsFacets> {
  const [companiesResult, aggregates] = await Promise.all([
    supabase
      .from("companies")
      .select("id, markets, primary_market_country, company_email_stats(email_count)")
      .is("deleted_at", null),
    computeBrandAggregates(supabase)
  ]);

  if (companiesResult.error) throw companiesResult.error;

  const marketSet = new Set<string>();
  const countrySet = new Set<string>();
  let totalBrands = 0;
  let brandsWithEmails = 0;
  for (const row of companiesResult.data ?? []) {
    totalBrands += 1;
    if (Array.isArray(row.markets)) {
      for (const market of row.markets) {
        if (typeof market === "string" && market.length > 0) {
          marketSet.add(market);
        }
      }
    }
    if (typeof row.primary_market_country === "string" && row.primary_market_country.length > 0) {
      countrySet.add(row.primary_market_country);
    }
    const stats = relationFirst(row.company_email_stats);
    const count = stats?.email_count ?? 0;
    if (count > 0) brandsWithEmails += 1;
  }

  const markets = Array.from(marketSet).sort((a, b) => a.localeCompare(b));
  const countries = Array.from(countrySet).sort((a, b) => a.localeCompare(b));

  const espProviders = Array.from(aggregates.espIdsInUse)
    .map((id) => ({
      id,
      label: ESP_LABELS[id] ?? id
    }))
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
    );

  // Round the observed max up to the next whole day and clamp into
  // [CADENCE_MIN_MAX, CADENCE_HARD_MAX] so the slider's right edge is
  // a tidy integer regardless of the data.
  const ceil = Math.ceil(aggregates.cadenceMaxObserved || 0);
  const cadenceMaxDays = Math.max(
    CADENCE_MIN_MAX,
    Math.min(CADENCE_HARD_MAX, ceil)
  );

  return {
    markets,
    countries,
    espProviders,
    cadenceMaxDays,
    totalBrands,
    brandsWithEmails
  };
}

/**
 * Strip characters that would break the PostgREST `or()` string or
 * accidentally turn the user's input into an ILIKE wildcard pattern.
 * Mirrors the helper in `explore-db.ts`.
 */
function sanitizeIlikeTerm(input: string): string {
  return input
    .replace(/[%_,(),"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
