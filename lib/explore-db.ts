import type { SupabaseClient } from "@supabase/supabase-js";
import { BRAND_LOGO_TRANSFORM, getSignedAssets } from "./storage";
import type { Database } from "@/types/supabase";

export type ExploreEmailCard = {
  id: string;
  subject: string;
  preheader: string | null;
  companyId: string | null;
  companyName: string;
  companyDomain: string | null;
  /**
   * Every market / category tag attached to the email's company, in
   * storage order. Empty when the brand is uncategorised. Replaces the
   * earlier scalar `companyMarket` field — brands can now sit in
   * multiple categories and the UI picks how to render the list.
   */
  companyMarkets: string[];
  /**
   * Short-lived signed URL into the `email-assets` bucket for the brand
   * logo we extracted from one of its emails. `null` if we haven't picked
   * a logo yet (the UI falls back to a monogram in that case).
   */
  companyLogoUrl: string | null;
  receivedAt: string;
  category: string;
  hasGif: boolean;
  hasDarkMode: boolean;
  discountPercent: number | null;
  promoCode: string | null;
};

export type ExploreSortKey =
  | "newest"
  | "oldest"
  | "brand_asc"
  | "brand_desc"
  | "discount_desc";

export type ExploreSearchParams = {
  query?: string;
  brandIds?: string[];
  markets?: string[];
  categories?: string[];
  hasGif?: boolean;
  hasDarkMode?: boolean;
  receivedAfter?: string | null;
  receivedBefore?: string | null;
  sort?: ExploreSortKey;
  page?: number;
  pageSize?: number;
};

export type ExploreSearchResult = {
  items: ExploreEmailCard[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type ExploreBrandFacet = {
  id: string;
  name: string;
  /**
   * Every market / category tag attached to the brand. Empty when the
   * brand is uncategorised. The UI may render only a subset (e.g. the
   * first two tags) when space is tight.
   */
  markets: string[];
  logoUrl: string | null;
};

export type ExploreFacets = {
  brands: ExploreBrandFacet[];
  markets: string[];
  categories: string[];
};

// 24 cards per page (3 cols x 8 rows, or 4 cols x 6 rows depending on
// viewport) keeps the per-page asset fan-out manageable. Each card is an
// iframe that downloads the full email body's images from Supabase
// Storage on the cold-cache path, so trimming this number directly
// reduces our Storage Egress.
export const EXPLORE_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 96;

/**
 * Server-side Explore search. Replaces the original "fetch the latest 36
 * rows and filter in memory" approach so the UI can search across every
 * email in the table.
 *
 * Brand-name matches are folded into the same query: when `query` is set
 * we first look up companies whose `name ILIKE %q%` and then OR the
 * resulting `company_id` set into the email-level ILIKE filter on
 * subject / preheader / primary CTA text / plain-text body. That keeps
 * the search to two round-trips even though we're effectively searching
 * across joined tables.
 *
 * Pagination is plain offset (`range(start, end)`) — fine for the table
 * sizes we expect for the foreseeable future. TODO: switch to keyset
 * pagination on `(received_at, id)` for the time-based sorts if the
 * dataset ever grows past ~100k rows, where deep offsets get expensive.
 */
export async function searchExploreEmails(
  supabase: SupabaseClient<Database>,
  params: ExploreSearchParams = {}
): Promise<ExploreSearchResult> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(params.pageSize ?? EXPLORE_PAGE_SIZE))
  );
  const sort: ExploreSortKey = params.sort ?? "newest";

  // Resolve brand-name matches up front so we can collapse the search
  // into a single OR clause on the email table.
  const trimmedQuery = (params.query ?? "").trim();
  let brandIdsFromQuery: string[] | null = null;
  if (trimmedQuery.length > 0) {
    const sanitizedForCompanies = sanitizeIlikeTerm(trimmedQuery);
    if (sanitizedForCompanies.length > 0) {
      const { data, error } = await supabase
        .from("companies")
        .select("id")
        .ilike("name", `%${sanitizedForCompanies}%`)
        .limit(500);
      if (error) throw error;
      brandIdsFromQuery = (data ?? []).map((row) => row.id);
    } else {
      brandIdsFromQuery = [];
    }
  }

  // Brand selections and brand-category (market) selections are UNION'd:
  // an email passes if its brand is selected OR the company carries any
  // of the selected category tags — matching the previous client-side
  // behavior. We collapse both into one `company_id IN (...)` clause by
  // first resolving the markets to their matching company IDs. The
  // `overlaps` filter on the `markets` array means a brand tagged
  // `["fashion", "ecommerce"]` shows up under both filters.
  let effectiveBrandIds: string[] | null = null;
  if (
    (params.brandIds && params.brandIds.length > 0) ||
    (params.markets && params.markets.length > 0)
  ) {
    const ids = new Set<string>(params.brandIds ?? []);
    if (params.markets && params.markets.length > 0) {
      const { data, error } = await supabase
        .from("companies")
        .select("id")
        .overlaps("markets", params.markets);
      if (error) throw error;
      for (const row of data ?? []) ids.add(row.id);
    }
    effectiveBrandIds = Array.from(ids);
    // If markets resolved to zero companies and no brands were picked,
    // short-circuit with an empty result rather than building a query
    // with `in("company_id", [])` (which behaves implementation-defined).
    if (effectiveBrandIds.length === 0) {
      return {
        items: [],
        total: 0,
        page,
        pageSize,
        hasMore: false
      };
    }
  }

  // Inner join only when sorting by brand name; otherwise a left join
  // keeps the (small handful of) orphan emails without a company_id
  // visible in Explore, matching the original behavior.
  const needsCompanyInnerJoin =
    params.sort === "brand_asc" || params.sort === "brand_desc";

  const companiesEmbed = needsCompanyInnerJoin
    ? "companies!inner(id, name, domain, markets, logo_storage_path)"
    : "companies(id, name, domain, markets, logo_storage_path)";

  let emailsQuery = supabase
    .from("captured_emails")
    .select(
      `id, subject, preheader, received_at, category, has_gif, has_dark_mode, discount_percent, promo_code, company_id, ${companiesEmbed}`,
      { count: "exact" }
    );

  if (effectiveBrandIds !== null) {
    emailsQuery = emailsQuery.in("company_id", effectiveBrandIds);
  }
  if (params.categories && params.categories.length > 0) {
    emailsQuery = emailsQuery.in("category", params.categories);
  }
  if (params.hasGif) {
    emailsQuery = emailsQuery.eq("has_gif", true);
  }
  if (params.hasDarkMode) {
    emailsQuery = emailsQuery.eq("has_dark_mode", true);
  }
  if (params.receivedAfter) {
    emailsQuery = emailsQuery.gte("received_at", params.receivedAfter);
  }
  if (params.receivedBefore) {
    emailsQuery = emailsQuery.lte("received_at", params.receivedBefore);
  }

  if (trimmedQuery.length > 0) {
    const sanitized = sanitizeIlikeTerm(trimmedQuery);
    if (sanitized.length > 0) {
      const term = `%${sanitized}%`;
      const clauses = [
        `subject.ilike.${term}`,
        `preheader.ilike.${term}`,
        `primary_cta_text.ilike.${term}`,
        `plain_text.ilike.${term}`
      ];
      if (brandIdsFromQuery && brandIdsFromQuery.length > 0) {
        // PostgREST `in.()` lists are comma-separated and live inside the
        // `or()` string, so any comma in the value would break parsing.
        // UUIDs don't contain commas; this is just defensive.
        const safeIds = brandIdsFromQuery
          .filter((id) => /^[0-9a-fA-F-]+$/.test(id))
          .join(",");
        if (safeIds.length > 0) {
          clauses.push(`company_id.in.(${safeIds})`);
        }
      }
      emailsQuery = emailsQuery.or(clauses.join(","));
    }
  }

  switch (sort) {
    case "oldest":
      emailsQuery = emailsQuery
        .order("received_at", { ascending: true })
        .order("id", { ascending: true });
      break;
    case "brand_asc":
      emailsQuery = emailsQuery
        .order("name", { ascending: true, referencedTable: "companies" })
        .order("received_at", { ascending: false });
      break;
    case "brand_desc":
      emailsQuery = emailsQuery
        .order("name", { ascending: false, referencedTable: "companies" })
        .order("received_at", { ascending: false });
      break;
    case "discount_desc":
      emailsQuery = emailsQuery
        .order("discount_percent", { ascending: false, nullsFirst: false })
        .order("received_at", { ascending: false });
      break;
    case "newest":
    default:
      emailsQuery = emailsQuery
        .order("received_at", { ascending: false })
        .order("id", { ascending: false });
      break;
  }

  const start = (page - 1) * pageSize;
  const end = start + pageSize - 1;
  emailsQuery = emailsQuery.range(start, end);

  const { data, error, count } = await emailsQuery;
  if (error) throw error;

  const rows = data ?? [];

  const logoPaths = new Set<string>();
  for (const row of rows) {
    const company = pickCompany(row.companies);
    if (company?.logo_storage_path) {
      logoPaths.add(company.logo_storage_path);
    }
  }
  const signed =
    logoPaths.size > 0
      ? await getSignedAssets(Array.from(logoPaths), {
          transform: BRAND_LOGO_TRANSFORM
        })
      : {};

  const items: ExploreEmailCard[] = rows.map((row) => {
    const company = pickCompany(row.companies);
    const logoPath = company?.logo_storage_path ?? null;
    return {
      id: row.id,
      subject: row.subject,
      preheader: row.preheader ?? null,
      companyId: company?.id ?? null,
      companyName: company?.name ?? "Unknown",
      companyDomain: company?.domain ?? null,
      companyMarkets: normalizeCompanyMarkets(company?.markets),
      companyLogoUrl: logoPath ? signed[logoPath] ?? null : null,
      receivedAt: row.received_at,
      category: row.category,
      hasGif: row.has_gif ?? false,
      hasDarkMode: row.has_dark_mode ?? false,
      discountPercent:
        row.discount_percent === null || row.discount_percent === undefined
          ? null
          : Number(row.discount_percent),
      promoCode: row.promo_code ?? null
    };
  });

  const total = typeof count === "number" ? count : items.length;
  const hasMore = start + items.length < total;

  return { items, total, page, pageSize, hasMore };
}

/**
 * Returns every brand / market / category currently present in the
 * Explore data set so the filter dropdowns can show all options
 * regardless of which page of results is currently loaded. Brands whose
 * companies have no captured emails yet are excluded — there's nothing
 * to filter to.
 */
export async function getExploreFacets(
  supabase: SupabaseClient<Database>
): Promise<ExploreFacets> {
  // We join through `captured_emails` so the facet list only contains
  // companies that actually have at least one email. The same query
  // gives us markets at no extra cost.
  const { data: emailRows, error: emailError } = await supabase
    .from("captured_emails")
    // `logo_storage_path` deliberately omitted: facets don't render
    // logos, so we save the DB round-trip column and the downstream
    // signed-URL fan-out.
    .select("category, company_id, companies!inner(id, name, markets)")
    .limit(10000);

  if (emailError) throw emailError;

  const brandMap = new Map<string, ExploreBrandFacet>();
  const marketSet = new Set<string>();
  const categorySet = new Set<string>();

  for (const row of emailRows ?? []) {
    if (row.category) categorySet.add(row.category);
    const company = pickCompany(row.companies);
    if (company) {
      const companyMarkets = normalizeCompanyMarkets(company.markets);
      for (const market of companyMarkets) marketSet.add(market);
      if (!brandMap.has(company.id)) {
        // We deliberately do NOT resolve logo signed URLs for facet
        // entries. The facet dropdown can render hundreds of brands;
        // batch-signing every one of them issues a signed URL (and a
        // resulting Storage GET when the user opens the dropdown) for
        // logos the user may never actually see. The grid cards
        // already carry their own logo URLs from `searchExploreEmails`,
        // which is the only place a logo actually renders today.
        brandMap.set(company.id, {
          id: company.id,
          name: company.name,
          markets: companyMarkets,
          logoUrl: null
        });
      }
    }
  }

  const brands: ExploreBrandFacet[] = Array.from(brandMap.values()).sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

  const markets = Array.from(marketSet).sort((a, b) => a.localeCompare(b));
  const categories = Array.from(categorySet).sort((a, b) => a.localeCompare(b));

  return { brands, markets, categories };
}

/**
 * Backwards-compatible thin wrapper so callers that only need the
 * default first page (no filters) can keep their old call shape. New
 * code should use `searchExploreEmails` directly.
 */
export async function getExploreEmails(
  supabase: SupabaseClient<Database>
): Promise<ExploreEmailCard[]> {
  const { items } = await searchExploreEmails(supabase, {
    page: 1,
    pageSize: EXPLORE_PAGE_SIZE
  });
  return items;
}

type CompaniesField =
  | {
      id: string;
      name: string;
      domain?: string | null;
      markets?: string[] | null;
      logo_storage_path?: string | null;
    }
  | Array<{
      id: string;
      name: string;
      domain?: string | null;
      markets?: string[] | null;
      logo_storage_path?: string | null;
    }>
  | null
  | undefined;

function pickCompany(value: CompaniesField) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/**
 * Defensive read for the `markets` array on an embedded `companies`
 * relation. Filters out non-strings so a hand-edited row can't leak
 * `null` / `undefined` entries into the serialised payload.
 */
export function normalizeCompanyMarkets(
  input: string[] | null | undefined
): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
}

/**
 * Strip characters that would break either the PostgREST `or()` string
 * (commas, parentheses, double quotes) or accidentally turn the user's
 * input into an ILIKE wildcard pattern (`%`, `_`). Returns a trimmed
 * fragment that is safe to splice into ``%${term}%``.
 */
function sanitizeIlikeTerm(input: string): string {
  return input
    .replace(/[%_,(),"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
