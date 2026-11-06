/**
 * The set of brand pages we offer to search engines, and the internal links
 * between them.
 *
 * A brand page only ranks if crawlers can reach it by following links. The
 * sitemap alone is a weak signal, and before this module most of the ~450
 * indexable brand pages had no inbound link at all: the directory's first
 * server-rendered page showed 36 brands (the rest load on scroll, which
 * crawlers don't do), and the "More <market> brands" strip ran an unordered
 * `limit(24)` query, so every brand in a market linked to the same six.
 *
 * {@link pickRelatedBrands} replaces that strip with a ring: brands sharing a
 * primary market are sorted by country, then name, and each one links to the
 * next few. Every brand in a market of two or more is therefore linked from
 * its neighbours, and those neighbours are as close as the data allows: a
 * Danish fashion brand sits between other Danish fashion brands.
 *
 * Read through the service-role client: companies aren't readable under RLS
 * for logged-out visitors and crawlers, who are exactly who follows these
 * links. Cached hourly, and every pick runs in memory over the cached list,
 * so the related-brands section costs a brand page no database query.
 */
import { unstable_cache } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { fetchAllRows } from "@/lib/supabase-paging";
import { MIN_INDEXABLE_EMAILS } from "@/lib/brand-summary";
import { formatMarketLabel } from "@/lib/market-label";
import { resolveBrandLogo } from "@/lib/logo-dev";
import { BRAND_LOGO_TRANSFORM, getSignedAssets } from "@/lib/storage";

export type IndexedBrand = {
  id: string;
  slug: string;
  name: string;
  /** Market tags as stored; the first one is the brand's primary market. */
  markets: string[];
  /** Primary audience country (ISO alpha-2), `null` when unknown. */
  country: string | null;
  domain: string | null;
  logoStoragePath: string | null;
  logoSource: string | null;
  emailCount: number;
};

/** How many brands the related-brands section links to: two rows of four. */
export const RELATED_BRAND_COUNT = 8;

/** Name order shared by the ring and the A–Z page, so both read the same. */
export function compareBrandNames(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}

/** Country first (unknown last), then name: the order of a market's ring. */
function compareCountryThenName(
  a: { name: string; country: string | null },
  b: { name: string; country: string | null }
) {
  if (a.country !== b.country) {
    if (a.country === null) return 1;
    if (b.country === null) return -1;
    return a.country < b.country ? -1 : 1;
  }
  return compareBrandNames(a, b);
}

/**
 * Every live brand with a slug, sorted by name, indexable or not. Thin brands
 * are kept so their pages can look themselves up and still link out; only
 * {@link loadIndexableBrands} entries are ever linked *to*.
 */
const loadBrandLinkCatalogue = unstable_cache(
  async (): Promise<IndexedBrand[]> => {
    const rows = await fetchAllRows((from, to) =>
      getSupabaseAdmin()
        .from("companies")
        .select(
          "id, slug, name, markets, primary_market_country, domain, logo_storage_path, logo_source, company_email_stats(email_count)"
        )
        .is("deleted_at", null)
        .order("id")
        .range(from, to)
    );

    const brands: IndexedBrand[] = [];
    for (const row of rows) {
      if (!row.slug) continue;
      const stats = Array.isArray(row.company_email_stats)
        ? row.company_email_stats[0]
        : row.company_email_stats;
      brands.push({
        id: row.id,
        slug: row.slug,
        name: row.name,
        markets: (row.markets ?? []).filter(
          (m: unknown): m is string => typeof m === "string" && m.length > 0
        ),
        country: row.primary_market_country ?? null,
        domain: row.domain ?? null,
        logoStoragePath: row.logo_storage_path ?? null,
        logoSource: row.logo_source ?? null,
        emailCount: stats?.email_count ?? 0
      });
    }
    return brands.sort(compareBrandNames);
  },
  ["brand-link-catalogue"],
  { revalidate: 3600 }
);

function isIndexable(brand: IndexedBrand): boolean {
  return brand.emailCount >= MIN_INDEXABLE_EMAILS;
}

/**
 * Every brand with enough captured email to be indexable (the same threshold
 * as the sitemap and the page's own noindex gate), sorted by name. Linking to
 * a noindexed page wastes the crawl, so nothing below the bar is included.
 */
export async function loadIndexableBrands(): Promise<IndexedBrand[]> {
  return (await loadBrandLinkCatalogue()).filter(isIndexable);
}

/**
 * The next `count` entries after `brand`'s place in a list sorted by
 * `compare`, wrapping at the end. `brand` need not be in the list (a thin
 * brand still links out): it starts from where it would sort.
 */
function ringAfter<B extends { id: string }>(
  list: IndexedBrand[],
  brand: B,
  count: number,
  compare: (a: IndexedBrand | B, b: IndexedBrand | B) => number
): IndexedBrand[] {
  const others = list.filter((b) => b.id !== brand.id).sort(compare);
  if (others.length <= count) return others;
  let start = others.findIndex((b) => compare(b, brand) > 0);
  if (start === -1) start = 0;
  return Array.from(
    { length: count },
    (_, i) => others[(start + i) % others.length]
  );
}

export type RelatedPick = {
  brands: IndexedBrand[];
  /** The market every pick shares, for the section's heading. */
  sharedMarket: string | null;
};

/**
 * Related brands to cross-link from a brand page.
 *
 * First the ring of brands with the same *primary* market, ordered by
 * country so neighbours share an audience: each brand in it is then
 * guaranteed inbound links from the brands just before it. Small markets are
 * topped up with brands carrying that market as a secondary tag, then with
 * brands sharing any of this brand's other markets. The heading only names
 * the market when every pick carries it.
 */
export function pickRelatedBrands(
  index: IndexedBrand[],
  brand: { id: string; name: string; markets: string[]; country: string | null },
  count = RELATED_BRAND_COUNT
): RelatedPick {
  const primary = brand.markets[0] ?? null;
  if (!primary) {
    return {
      brands: ringAfter(index, brand, count, compareBrandNames),
      sharedMarket: null
    };
  }

  const picks = ringAfter(
    index.filter((b) => b.markets[0] === primary),
    brand,
    count,
    compareCountryThenName
  );
  const taken = new Set([brand.id, ...picks.map((b) => b.id)]);
  const topUp = (pool: IndexedBrand[]) => {
    for (const b of ringAfter(pool, brand, count, compareCountryThenName)) {
      if (picks.length >= count) return;
      if (taken.has(b.id)) continue;
      picks.push(b);
      taken.add(b.id);
    }
  };

  topUp(index.filter((b) => b.markets.includes(primary)));
  const sharedMarket = picks.length > 0 ? primary : null;
  const before = picks.length;
  topUp(index.filter((b) => b.markets.some((m) => brand.markets.includes(m))));

  return {
    brands: picks,
    sharedMarket: picks.length === before ? sharedMarket : null
  };
}

/** One linked brand, ready to render. Plain data, safe to cache with a page. */
export type RelatedBrandCard = {
  slug: string;
  name: string;
  logoUrl: string | null;
  /** Pretty label of the brand's primary market, e.g. "Home & Living". */
  marketLabel: string | null;
  country: string | null;
  emailCount: number;
};

export type RelatedBrands = {
  brands: RelatedBrandCard[];
  /** Pretty label of the market every card shares, for the heading. */
  sharedMarketLabel: string | null;
};

/**
 * The related-brands section for one brand page, by brand id alone, so the
 * caller can start it alongside its other loads instead of after them.
 *
 * Costs no database query: the catalogue comes from the hourly data cache
 * and the pick runs in memory. Logos are Logo.dev URLs built from the domain,
 * except admin-picked ones, which are signed (a string build on the CDN).
 * Never throws: a failure costs the page its related links, never the page.
 */
export async function loadRelatedBrands(
  brandId: string,
  count = RELATED_BRAND_COUNT
): Promise<RelatedBrands> {
  try {
    const catalogue = await loadBrandLinkCatalogue();
    const self = catalogue.find((b) => b.id === brandId);
    if (!self) return { brands: [], sharedMarketLabel: null };

    const pick = pickRelatedBrands(catalogue.filter(isIndexable), self, count);

    const manualPaths = pick.brands
      .filter((b) => b.logoSource === "manual" && b.logoStoragePath)
      .map((b) => b.logoStoragePath as string);
    const signed =
      manualPaths.length > 0
        ? await getSignedAssets(manualPaths, {
            transform: BRAND_LOGO_TRANSFORM
          }).catch((err) => {
            console.error("Failed to sign related brand logos", err);
            return {} as Record<string, string>;
          })
        : {};

    return {
      brands: pick.brands.map((b) => ({
        slug: b.slug,
        name: b.name,
        logoUrl: resolveBrandLogo(
          b.logoStoragePath ? signed[b.logoStoragePath] ?? null : null,
          b.logoSource,
          b.domain
        ),
        marketLabel: b.markets[0] ? formatMarketLabel(b.markets[0]) : null,
        country: b.country,
        emailCount: b.emailCount
      })),
      sharedMarketLabel: pick.sharedMarket
        ? formatMarketLabel(pick.sharedMarket)
        : null
    };
  } catch (err) {
    console.error("Failed to load related brands", err);
    return { brands: [], sharedMarketLabel: null };
  }
}

export type HomepageCategory = {
  /** Pretty label, e.g. "Home & Living". */
  label: string;
  /** How many indexable brands carry this primary market. */
  brandCount: number;
  brands: { slug: string; name: string }[];
};

/**
 * The homepage's "brands by category" block: the biggest primary markets,
 * each with its most-tracked brands. Puts those brand pages one click from the
 * homepage, the page search engines trust most, instead of three clicks deep
 * through the directory. Picked in memory from the cached catalogue.
 */
export async function loadHomepageCategories(
  categoryCount = 6,
  perCategory = 6
): Promise<HomepageCategory[]> {
  try {
    const byMarket = new Map<string, IndexedBrand[]>();
    for (const brand of await loadIndexableBrands()) {
      const primary = brand.markets[0];
      if (!primary) continue;
      const list = byMarket.get(primary) ?? [];
      list.push(brand);
      byMarket.set(primary, list);
    }
    return [...byMarket.entries()]
      .filter(([, list]) => list.length >= perCategory)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, categoryCount)
      .map(([market, list]) => ({
        label: formatMarketLabel(market),
        brandCount: list.length,
        brands: [...list]
          .sort((a, b) => b.emailCount - a.emailCount || compareBrandNames(a, b))
          .slice(0, perCategory)
          .map(({ slug, name }) => ({ slug, name }))
      }));
  } catch (err) {
    console.error("Failed to load homepage brand categories", err);
    return [];
  }
}
