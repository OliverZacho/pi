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
 * primary market are sorted by name and each one links to the next few, so
 * every brand in a market of two or more is linked from its neighbours.
 *
 * Read through the service-role client: companies aren't readable under RLS
 * for logged-out visitors and crawlers, who are exactly who follows these
 * links. Cached hourly; the list changes only when a brand crosses the
 * indexability threshold.
 */
import { unstable_cache } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { MIN_INDEXABLE_EMAILS } from "@/lib/brand-summary";

export type IndexedBrand = {
  id: string;
  slug: string;
  name: string;
  /** Market tags as stored; the first one is the brand's primary market. */
  markets: string[];
  emailCount: number;
};

/** PostgREST's max rows per response (Supabase default). */
const PAGE_SIZE = 1000;

/** Name order shared by the ring and the A–Z page, so both read the same. */
export function compareBrandNames(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}

/**
 * Every brand with enough captured email to be indexable (the same threshold
 * as the sitemap and the page's own noindex gate), sorted by name. Linking to
 * a noindexed page wastes the crawl, so nothing below the bar is included.
 */
export const loadIndexableBrands = unstable_cache(
  async (): Promise<IndexedBrand[]> => {
    // Paged: PostgREST returns at most 1,000 rows per request, and the
    // catalogue is closing in on that.
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await getSupabaseAdmin()
        .from("companies")
        .select("id, slug, name, markets, company_email_stats(email_count)")
        .is("deleted_at", null)
        .order("id")
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }

    const brands: IndexedBrand[] = [];
    for (const row of rows) {
      const stats = Array.isArray(row.company_email_stats)
        ? row.company_email_stats[0]
        : row.company_email_stats;
      const emailCount = stats?.email_count ?? 0;
      if (emailCount < MIN_INDEXABLE_EMAILS || !row.slug) continue;
      brands.push({
        id: row.id,
        slug: row.slug,
        name: row.name,
        markets: (row.markets ?? []).filter(
          (m: unknown): m is string => typeof m === "string" && m.length > 0
        ),
        emailCount
      });
    }
    return brands.sort(compareBrandNames);
  },
  ["indexable-brands"],
  { revalidate: 3600 }
);

/**
 * The next `count` entries after `brand`'s place in a name-sorted list,
 * wrapping at the end. `brand` need not be in the list (a thin brand still
 * links out): it starts from where its name would sort.
 */
function ringAfter(
  list: IndexedBrand[],
  brand: { id: string; name: string },
  count: number
): IndexedBrand[] {
  const others = list.filter((b) => b.id !== brand.id);
  if (others.length <= count) return others;
  let start = others.findIndex((b) => compareBrandNames(b, brand) > 0);
  if (start === -1) start = 0;
  return Array.from(
    { length: count },
    (_, i) => others[(start + i) % others.length]
  );
}

export type RelatedPick = {
  brands: { slug: string; name: string }[];
  /** The market every pick shares, for the "More <market> brands" heading. */
  sharedMarket: string | null;
};

/**
 * Same-market brands to cross-link from a brand page.
 *
 * First the ring of brands with the same *primary* market: each brand in it
 * is then guaranteed inbound links from the brands just before it. Small
 * markets are topped up with brands carrying that market as a secondary tag,
 * then with brands sharing any of this brand's other markets. The heading
 * only names the market when every pick carries it.
 */
export function pickRelatedBrands(
  index: IndexedBrand[],
  brand: { id: string; name: string; markets: string[] },
  count = 6
): RelatedPick {
  const primary = brand.markets[0] ?? null;
  if (!primary) {
    return { brands: ringAfter(index, brand, count), sharedMarket: null };
  }

  const picks = ringAfter(
    index.filter((b) => b.markets[0] === primary),
    brand,
    count
  );
  const taken = new Set([brand.id, ...picks.map((b) => b.id)]);
  const topUp = (pool: IndexedBrand[]) => {
    for (const b of ringAfter(pool, brand, count)) {
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
    brands: picks.map(({ slug, name }) => ({ slug, name })),
    sharedMarket: picks.length === before ? sharedMarket : null
  };
}
