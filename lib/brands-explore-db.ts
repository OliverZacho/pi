import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ESP_LABELS, type EspProvider } from "./admin-types";
import { resolveBrandLogo } from "./logo-dev";
import { BRAND_LOGO_TRANSFORM, getSignedAssets } from "./storage";
import { getSupabaseAdmin } from "./supabase-admin";
import { fetchAllRows } from "./supabase-paging";
import type { Database } from "@/types/supabase";

/**
 * Single row in the Brands grid. Cards stay deliberately minimal — the
 * heavy stats live on the per-brand dashboard (`/brands/[id]`) and we
 * only expose what's directly filterable from this page (market, ESP,
 * send cadence) so the visual layer doesn't drown the user in numbers.
 */
export type BrandsExploreCard = {
  id: string;
  /** Stable public handle for the brand's `/brands/<slug>` URL. */
  slug: string;
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
  minEmailCount?: number | null;
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

/** Smallest acceptable upper bound for the cadence slider, in days. */
const CADENCE_MIN_MAX = 7;
/** Hard upper bound for the slider so a single outlier doesn't push it absurd. */
const CADENCE_HARD_MAX = 60;

type CompanyRow = {
  id: string;
  slug: string;
  name: string;
  domain: string;
  markets: string[] | null;
  primary_market_country: string | null;
  is_global: boolean | null;
  subscribed_since: string;
  logo_storage_path: string | null;
  logo_source: string | null;
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
 * One tracked brand with its email counters and send stats folded in.
 * Plain JSON (no Maps / Dates) so it survives the data cache.
 */
type CatalogueBrand = Omit<CompanyRow, "company_email_stats"> & {
  emailCount: number;
  lastReceivedAt: string | null;
  primaryEsp: EspProvider | null;
  avgDaysBetween: number | null;
};

/**
 * How stale the cached catalogue may get before a background refresh: a day.
 * The founder signed off on directory stats (and newly added or edited
 * brands) lagging by up to 24 hours in exchange for load time.
 */
const CATALOGUE_REVALIDATE_SECONDS = 60 * 60 * 24;

/**
 * Every non-deleted brand plus its counters and ESP / cadence stats, cached
 * across requests and instances for {@link CATALOGUE_REVALIDATE_SECONDS}.
 *
 * `brand_send_stats` aggregates every captured email on each read, which
 * takes seconds whenever its pages have fallen out of Postgres's buffer
 * cache. Nothing on the directory needs to-the-minute numbers, so the
 * catalogue is read once and served stale-while-revalidate: visitors only
 * ever wait on it when the cache is completely empty.
 *
 * Read with the service-role client because the cache is shared across
 * viewers. That exposes nothing new: the logged-out directory already
 * serves this exact data through the public API.
 */
const loadBrandCatalogue = unstable_cache(
  async (): Promise<CatalogueBrand[]> => {
    const admin = getSupabaseAdmin();
    const [companies, aggregates] = await Promise.all([
      // Paged: PostgREST stops at 1,000 rows.
      fetchAllRows((from, to) =>
        admin
          .from("companies")
          .select(
            "id, slug, name, domain, markets, primary_market_country, is_global, subscribed_since, logo_storage_path, logo_source, company_email_stats(email_count, last_received_at)"
          )
          .is("deleted_at", null)
          .order("id")
          .range(from, to)
      ),
      computeBrandAggregates(admin)
    ]);

    return companies.map((row) => {
      const { company_email_stats, ...company } = row as CompanyRow;
      const stats = relationFirst(company_email_stats);
      const agg = aggregates.perBrand.get(company.id);
      return {
        ...company,
        emailCount: stats?.email_count ?? 0,
        lastReceivedAt: stats?.last_received_at ?? null,
        primaryEsp: agg?.primaryEsp ?? null,
        avgDaysBetween: agg?.avgDaysBetween ?? null
      };
    });
  },
  ["brand-catalogue"],
  { revalidate: CATALOGUE_REVALIDATE_SECONDS }
);

/** Parse an ISO timestamp to epoch ms, `null` when absent or invalid. */
function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Server-side Brands search over the cached catalogue
 * ({@link loadBrandCatalogue}). Every filter, the sort, and pagination run
 * in memory, which is cheap at the brand counts we expect (hundreds to low
 * thousands). The free-text term has to run in memory regardless: it also
 * matches a brand's *category* (e.g. "kids" → "baby & kids"), and PostgREST
 * can't do a partial `ilike` against a `text[]` element.
 */
export async function searchBrands(
  params: BrandsSearchParams = {}
): Promise<BrandsSearchResult> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(params.pageSize ?? BRANDS_PAGE_SIZE))
  );
  const sort: BrandsSortKey = params.sort ?? "most_active";

  const searchTerm = (params.query ?? "").trim().toLowerCase();

  const enriched = (await loadBrandCatalogue()).map((row) => ({
    ...row,
    lastReceivedMs: toMs(row.lastReceivedAt),
    subscribedMs: toMs(row.subscribed_since) ?? 0
  }));

  let filtered = enriched;
  if (params.markets && params.markets.length > 0) {
    // Overlap: a brand tagged `["fashion", "ecommerce"]` matches either
    // filter.
    const wanted = new Set(params.markets);
    filtered = filtered.filter(
      (row) =>
        Array.isArray(row.markets) &&
        row.markets.some((market) => wanted.has(market))
    );
  }
  if (params.global) {
    filtered = filtered.filter((row) => row.is_global === true);
  } else if (params.country) {
    // Restrict to one audience so peer comparisons stay same-market. Brands
    // whose region we couldn't determine (NULL) are intentionally excluded
    // when a country filter is active.
    filtered = filtered.filter(
      (row) => row.primary_market_country === params.country
    );
  }
  const subscribedAfterMs = toMs(params.subscribedAfter);
  if (subscribedAfterMs !== null) {
    filtered = filtered.filter((row) => row.subscribedMs >= subscribedAfterMs);
  }
  const subscribedBeforeMs = toMs(params.subscribedBefore);
  if (subscribedBeforeMs !== null) {
    filtered = filtered.filter((row) => row.subscribedMs <= subscribedBeforeMs);
  }
  if (searchTerm.length > 0) {
    // Match name, domain, or any category label the brand is tagged with,
    // so the picker's "Search by name or category" promise holds.
    filtered = filtered.filter((row) => {
      if (row.name.toLowerCase().includes(searchTerm)) return true;
      if (row.domain && row.domain.toLowerCase().includes(searchTerm)) {
        return true;
      }
      return (
        Array.isArray(row.markets) &&
        row.markets.some(
          (market) =>
            typeof market === "string" &&
            market.toLowerCase().includes(searchTerm)
        )
      );
    });
  }
  if (typeof params.minEmailCount === "number" && params.minEmailCount > 0) {
    const min = Math.floor(params.minEmailCount);
    filtered = filtered.filter((row) => row.emailCount >= min);
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
    const logoUrl = resolveBrandLogo(
      row.logo_storage_path ? signed[row.logo_storage_path] ?? null : null,
      row.logo_source,
      row.domain
    );
    return {
      id: row.id,
      slug: row.slug,
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
 * Reads the `brand_send_stats` view (one row per brand: modal ESP and
 * mean days between sends, aggregated in the DB) and returns the
 * per-brand map. Returned alongside is the set of primary ESPs in use
 * and the largest observed cadence — both used by the facets endpoint
 * to seed the filter UI. The ESP menu is seeded from *primary* ESPs
 * only, since the ESP filter matches a brand's primary; an ESP that is
 * nobody's primary would be a dead filter option.
 */
export async function computeBrandAggregates(
  supabase: SupabaseClient<Database>,
  companyIds?: string[]
): Promise<AggregateResult> {
  // One row per brand, so the unscoped read is the whole catalogue: paged,
  // since PostgREST stops at 1,000 rows.
  const data = await fetchAllRows((from, to) => {
    let statsQuery = supabase
      .from("brand_send_stats")
      .select("company_id, primary_esp, avg_days_between");

    // When the caller only needs a known set of brands (e.g. the user's
    // follow list), scope to those companies.
    if (companyIds && companyIds.length > 0) {
      statsQuery = statsQuery.in("company_id", companyIds);
    }

    return statsQuery.order("company_id").range(from, to);
  });

  const perBrand = new Map<string, BrandAggregate>();
  const espIdsInUse = new Set<EspProvider>();
  let cadenceMaxObserved = 0;

  for (const row of data) {
    if (!row.company_id) continue;
    const primaryEsp = (row.primary_esp as EspProvider | null) ?? null;
    if (primaryEsp) espIdsInUse.add(primaryEsp);
    const avgDaysBetween =
      typeof row.avg_days_between === "number" ? row.avg_days_between : null;
    if (avgDaysBetween !== null && avgDaysBetween > cadenceMaxObserved) {
      cadenceMaxObserved = avgDaysBetween;
    }
    perBrand.set(row.company_id, { primaryEsp, avgDaysBetween });
  }

  return { perBrand, espIdsInUse, cadenceMaxObserved };
}

/**
 * Lists every market slug currently in use, every ESP we have a
 * primary signal for, and a sensible upper bound for the cadence
 * slider. Used by the filter UI to seed its menus.
 */
export async function getBrandsFacets(): Promise<BrandsFacets> {
  const catalogue = await loadBrandCatalogue();

  const marketSet = new Set<string>();
  const countrySet = new Set<string>();
  const espIdsInUse = new Set<EspProvider>();
  let cadenceMaxObserved = 0;
  let totalBrands = 0;
  let brandsWithEmails = 0;
  for (const row of catalogue) {
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
    if (row.emailCount > 0) brandsWithEmails += 1;
    if (row.primaryEsp) espIdsInUse.add(row.primaryEsp);
    if (row.avgDaysBetween !== null && row.avgDaysBetween > cadenceMaxObserved) {
      cadenceMaxObserved = row.avgDaysBetween;
    }
  }

  const markets = Array.from(marketSet).sort((a, b) => a.localeCompare(b));
  const countries = Array.from(countrySet).sort((a, b) => a.localeCompare(b));

  const espProviders = Array.from(espIdsInUse)
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
  const ceil = Math.ceil(cadenceMaxObserved || 0);
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
 * Every tracked brand's domain, for deduping external brand search results
 * against the catalogue. Paged: PostgREST stops at 1,000 rows.
 */
export async function listTrackedDomains(
  supabase: SupabaseClient<Database>
): Promise<(string | null)[]> {
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from("companies")
      .select("domain")
      .is("deleted_at", null)
      .order("id")
      .range(from, to)
  );
  return rows.map((row) => row.domain);
}
