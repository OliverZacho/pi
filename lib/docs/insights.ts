/**
 * Archive-wide aggregates for the Learn (`/docs`) library.
 *
 * Each `getX` function returns real, current numbers derived from the captured
 * email archive so the benchmark articles ("Which ESP do brands use?", "Best
 * time to send", …) can quote live figures that grow as more email lands. The
 * shape mirrors the per-brand teaser in `app/api/explore/brand-insight/route.ts`
 * (cohort/ESP logic) and reuses the same zoned-hour bucketing as
 * `lib/brand-db.ts` — only here the cohort is the *whole* archive rather than a
 * single brand.
 *
 * Server-only: every function reaches the database through the service-role
 * `getSupabaseAdmin()` client, exactly like the public teaser routes. They are
 * imported by the `/docs/[slug]` server component, which is ISR-cached
 * (`revalidate`). The archive itself is summarised per brand in the database
 * (see `loadArchiveSample`); nothing here reads individual emails.
 *
 * Resilience: a load failure returns `null`/empty, never throws — the article
 * page falls back to neutral prose instead of a 500.
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  EMAIL_CATEGORY_LABELS,
  ESP_LABELS,
  NON_CAMPAIGN_CATEGORIES,
  type EmailCategory,
  type EspProvider
} from "@/lib/admin-types";
import {
  formatHourOfDay,
  getActiveTimeZone
} from "@/lib/datetime";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { loadIndexableBrands } from "@/lib/brand-link-index";

/** A brand needs at least this many sends to count toward a benchmark. */
const MIN_SENDS_PER_BRAND = 4;
/** An industry needs at least this many brands before we quote it. */
const MIN_BRANDS_PER_INDUSTRY = 6;
/** How long a computed benchmark is cached across requests (seconds). */
const INSIGHT_TTL = 1800;

/**
 * One brand's totals over the archive slice (the newest 40,000 de-duplicated
 * sends). Rolled up in the database by the `docs_brand_insight_stats`
 * snapshot; every benchmark below is built from these, never from emails.
 */
type BrandAgg = {
  n: number;
  espCounts: Map<string, number>;
  /** Sends carrying a discount in (0, 100]. */
  discCount: number;
  discDepthSum: number;
  discDepthMax: number;
  minMs: number;
  maxMs: number;
  /** Sends per hour of day in the platform time zone (index 0 = midnight). */
  hourly: number[];
  /** Sends per classified type (e.g. "sale"); unclassified sends left out. */
  categories: Map<string, number>;
};

type BrandMeta = { markets: string[]; country: string | null };

type ArchiveSample = {
  /** Brand id → its totals. Includes since-deleted brands, as the old scan did. */
  stats: Map<string, BrandAgg>;
  /** Tracked-brand id → its industry tags + primary country. */
  brands: Map<string, BrandMeta>;
  /** Total tracked brands (not soft-deleted). */
  brandCount: number;
};

type InsightsPayload = {
  companies: { id: string; markets: string[] | null; country: string | null }[];
  brands: {
    company_id: string;
    sends: number;
    discount_sends: number;
    discount_sum: number;
    discount_max: number;
    first_at: string;
    last_at: string;
    esp_counts: Record<string, number>;
    hour_counts: Record<string, number>;
    category_counts: Record<string, number>;
  }[];
};

/**
 * Loads the per-brand archive summary once per render (React `cache` dedups it
 * across the `getX` helpers). One RPC reading a snapshot refreshed by pg_cron
 * twice an hour (supabase/migrations/20261125190100_docs_archive_insights.sql),
 * so a cache refresh here costs ~30 ms however large the archive grows.
 *
 * It used to page ~22 x 1,000 email rows out of captured_emails in parallel;
 * each refresh then took 13 to 19 s per page and stalled ingest and every
 * other query behind it.
 *
 * Send hours are bucketed in the snapshot in Europe/Copenhagen, the platform
 * zone (`getActiveTimeZone()`); the labels below format in the same zone.
 */
const loadArchiveSample = cache(async (): Promise<ArchiveSample | null> => {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("docs_archive_insights");
    if (error) throw error;
    const payload = data as unknown as InsightsPayload | null;
    if (!payload) return null;

    const brands = new Map<string, BrandMeta>();
    for (const c of payload.companies ?? []) {
      brands.set(c.id, {
        markets: (c.markets ?? []).filter(Boolean),
        country: c.country ?? null
      });
    }

    const stats = new Map<string, BrandAgg>();
    for (const b of payload.brands ?? []) {
      const hourly = new Array<number>(24).fill(0);
      for (const [hour, n] of Object.entries(b.hour_counts ?? {})) {
        const h = Number(hour);
        if (Number.isInteger(h) && h >= 0 && h < 24) hourly[h] += n;
      }
      stats.set(b.company_id, {
        n: b.sends,
        espCounts: new Map(Object.entries(b.esp_counts ?? {})),
        discCount: b.discount_sends,
        discDepthSum: b.discount_sum,
        discDepthMax: b.discount_max,
        minMs: new Date(b.first_at).getTime(),
        maxMs: new Date(b.last_at).getTime(),
        hourly,
        categories: new Map(Object.entries(b.category_counts ?? {}))
      });
    }

    return { stats, brands, brandCount: brands.size };
  } catch (error) {
    console.error("[docs/insights] sample load failed", error);
    return null;
  }
});

/* ----------------------------- shared helpers ----------------------------- */

function topEspOf(a: BrandAgg): string | null {
  let top: string | null = null;
  let best = -1;
  for (const [esp, n] of a.espCounts) {
    if (n > best) {
      best = n;
      top = esp;
    }
  }
  return top;
}

/** Average sends per week, clamping the active span to ≥7 days. */
function brandPerWeek(a: BrandAgg): number {
  const days = Math.max(7, (a.maxMs - a.minMs) / 86_400_000);
  return (7 * a.n) / days;
}

/** Industry tag → ids of brands carrying it (a brand can sit in several). */
function industryBrandMap(sample: ArchiveSample): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const [id, meta] of sample.brands) {
    for (const tag of meta.markets) {
      const arr = m.get(tag);
      if (arr) arr.push(id);
      else m.set(tag, [id]);
    }
  }
  return m;
}

/** Largest industries (by brand count) that clear the noise floor. */
function topIndustries(
  indMap: Map<string, string[]>,
  minBrands: number,
  limit: number
): { key: string; brandIds: string[] }[] {
  return [...indMap.entries()]
    .filter(([, ids]) => ids.length >= minBrands)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, limit)
    .map(([key, brandIds]) => ({ key, brandIds }));
}

function prettyIndustry(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return key;
  return trimmed
    .split(/[\s_-]+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function espLabel(id: string): string {
  return ESP_LABELS[id as EspProvider] ?? prettyIndustry(id);
}

function categoryLabel(id: string): string {
  return EMAIL_CATEGORY_LABELS[id as EmailCategory] ?? prettyIndustry(id);
}

const avg = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/* ----------------------------- brand examples ----------------------------- */

/**
 * A real brand behind a benchmark, linked from the article to its brand page.
 * `value` is the brand's own figure for the article's metric (formatted by
 * `article-insights.ts`); `label` carries a name where the metric needs one
 * (the ESP, the campaign type).
 */
export type ExampleBrand = {
  slug: string;
  name: string;
  value: number;
  label?: string;
};

/** How many brands an article names. */
const EXAMPLE_COUNT = 8;
/**
 * Sends a brand needs before we quote its own figure. Far above the benchmark
 * floor: an article naming a brand should be quoting a settled number, not
 * four emails.
 */
const EXAMPLE_MIN_SENDS = 20;

/**
 * Resolves ranked brand ids to linkable examples, keeping only brands whose
 * page is indexable (linking to a noindexed page wastes the crawl). A lookup
 * failure costs the article its examples, never the article.
 */
async function toExamples(
  ranked: { id: string; value: number; label?: string }[],
  limit = EXAMPLE_COUNT
): Promise<ExampleBrand[]> {
  const index = await loadIndexableBrands().catch((error) => {
    console.error("[docs/insights] brand index load failed", error);
    return [];
  });
  const byId = new Map(index.map((b) => [b.id, b]));
  const out: ExampleBrand[] = [];
  for (const r of ranked) {
    const brand = byId.get(r.id);
    if (!brand) continue;
    out.push({ slug: brand.slug, name: brand.name, value: r.value, label: r.label });
    if (out.length >= limit) break;
  }
  return out;
}

/* ------------------------------- ESP usage -------------------------------- */

export type EspInsights = {
  /** All tracked brands (the headline "brands we track"). */
  brandCount: number;
  /** Brands where we've confidently detected a primary ESP. */
  espBrandCount: number;
  top: { label: string; share: number };
  second: { label: string; share: number } | null;
  /** Top platforms by share of brands, descending. */
  ranking: { label: string; share: number }[];
  byIndustry: { industry: string; topEsp: string; share: number }[];
  /** The busiest brands on each of the two leading platforms. */
  examples: ExampleBrand[];
};

export const getEspInsights = unstable_cache(
  async (): Promise<EspInsights | null> => {
  const sample = await loadArchiveSample();
  if (!sample) return null;

  const agg = sample.stats;
  const brandEsp = new Map<string, string>();
  for (const [id, a] of agg) {
    if (a.n < MIN_SENDS_PER_BRAND) continue;
    const top = topEspOf(a);
    if (top) brandEsp.set(id, top);
  }
  if (brandEsp.size === 0) return null;

  const total = brandEsp.size;
  const counts = new Map<string, number>();
  for (const esp of brandEsp.values()) {
    counts.set(esp, (counts.get(esp) ?? 0) + 1);
  }
  const ranking = [...counts.entries()]
    .map(([esp, c]) => ({ label: espLabel(esp), share: Math.round((100 * c) / total) }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 6);

  const indMap = industryBrandMap(sample);
  const byIndustry = topIndustries(indMap, MIN_BRANDS_PER_INDUSTRY, 4)
    .map(({ key, brandIds }) => {
      const local = new Map<string, number>();
      let n = 0;
      for (const id of brandIds) {
        const esp = brandEsp.get(id);
        if (!esp) continue;
        local.set(esp, (local.get(esp) ?? 0) + 1);
        n += 1;
      }
      let top: string | null = null;
      let best = -1;
      for (const [esp, c] of local) {
        if (c > best) {
          best = c;
          top = esp;
        }
      }
      return top && n > 0
        ? { industry: prettyIndustry(key), topEsp: espLabel(top), share: Math.round((100 * best) / n) }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const leaders = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([esp]) => esp);
  const examples: ExampleBrand[] = [];
  for (const esp of leaders) {
    const ranked = [...brandEsp.entries()]
      .filter(([id, e]) => e === esp && (agg.get(id)?.n ?? 0) >= EXAMPLE_MIN_SENDS)
      .sort((a, b) => (agg.get(b[0])?.n ?? 0) - (agg.get(a[0])?.n ?? 0))
      .map(([id]) => ({ id, value: agg.get(id)?.n ?? 0, label: espLabel(esp) }));
    examples.push(...(await toExamples(ranked, EXAMPLE_COUNT / 2)));
  }

  return {
    brandCount: sample.brandCount,
    espBrandCount: total,
    top: ranking[0],
    second: ranking[1] ?? null,
    ranking,
    byIndustry,
    examples
  };
  },
  ["docs-insights:esp:v3"],
  { revalidate: INSIGHT_TTL }
);

/* ------------------------------- Send time -------------------------------- */

export type SendTimeInsights = {
  sendCount: number;
  peak: { label: string; share: number };
  peakHour: number;
  /** Send volume bucketed into all 24 hours (index 0 = midnight). */
  hourly: number[];
  morningShare: number;
  afternoonShare: number;
  eveningShare: number;
  topHours: { label: string; value: number; display: string }[];
  byIndustry: { industry: string; peakLabel: string }[];
  /** Brands whose own busiest hour is the archive's peak, most concentrated first. */
  examples: ExampleBrand[];
};

export const getSendTimeInsights = unstable_cache(
  async (): Promise<SendTimeInsights | null> => {
    const sample = await loadArchiveSample();
    if (!sample) return null;

    const zone = getActiveTimeZone();
    const hourly = new Array<number>(24).fill(0);
    const indHourly = new Map<string, number[]>();
    const brandHourly = new Map<string, number[]>();

    for (const [id, a] of sample.stats) {
      brandHourly.set(id, a.hourly);
      const meta = sample.brands.get(id);
      for (let h = 0; h < 24; h++) {
        const c = a.hourly[h];
        if (c === 0) continue;
        hourly[h] += c;
        if (!meta) continue;
        for (const tag of meta.markets) {
          let arr = indHourly.get(tag);
          if (!arr) {
            arr = new Array<number>(24).fill(0);
            indHourly.set(tag, arr);
          }
          arr[h] += c;
        }
      }
    }

    const totalSends = hourly.reduce((a, b) => a + b, 0);
    if (totalSends === 0) return null;

    let peakH = 0;
    for (let i = 1; i < 24; i++) if (hourly[i] > hourly[peakH]) peakH = i;

    const windowShare = (lo: number, hi: number) => {
      let s = 0;
      for (let i = lo; i <= hi; i++) s += hourly[i];
      return Math.round((100 * s) / totalSends);
    };

    const label = (h: number) =>
      formatHourOfDay(h, { case: "lower", withZone: true, zone });

    const topHours = hourly
      .map((c, h) => ({ h, c }))
      .filter((x) => x.c > 0)
      .sort((a, b) => b.c - a.c)
      .slice(0, 5)
      .map(({ h, c }) => ({
        label: label(h),
        value: c,
        display: `${Math.round((100 * c) / totalSends)}%`
      }));

    const indMap = industryBrandMap(sample);
    const byIndustry = topIndustries(indMap, MIN_BRANDS_PER_INDUSTRY, 4)
      .map(({ key }) => {
        const arr = indHourly.get(key);
        if (!arr) return null;
        let p = 0;
        for (let i = 1; i < 24; i++) if (arr[i] > arr[p]) p = i;
        return { industry: prettyIndustry(key), peakLabel: label(p) };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const atPeak: { id: string; value: number }[] = [];
    for (const [id, counts] of brandHourly) {
      const n = counts.reduce((a, b) => a + b, 0);
      if (n < EXAMPLE_MIN_SENDS) continue;
      if (counts.indexOf(Math.max(...counts)) !== peakH) continue;
      atPeak.push({ id, value: Math.round((100 * counts[peakH]) / n) });
    }
    atPeak.sort((a, b) => b.value - a.value);

    return {
      sendCount: totalSends,
      peak: { label: label(peakH), share: Math.round((100 * hourly[peakH]) / totalSends) },
      peakHour: peakH,
      hourly,
      morningShare: windowShare(6, 11),
      afternoonShare: windowShare(12, 16),
      eveningShare: windowShare(17, 21),
      topHours,
      byIndustry,
      examples: await toExamples(atPeak)
    };
  },
  ["docs-insights:send-time:v3"],
  { revalidate: INSIGHT_TTL }
);

/* -------------------------------- Cadence --------------------------------- */

export type CadenceInsights = {
  brandCount: number;
  avgPerWeek: number;
  busiest: { industry: string; perWeek: number } | null;
  calmest: { industry: string; perWeek: number } | null;
  byIndustry: { industry: string; perWeek: number }[];
  /** The busiest senders with a settled history, by emails per week. */
  examples: ExampleBrand[];
};

export const getCadenceInsights = unstable_cache(
  async (): Promise<CadenceInsights | null> => {
    const sample = await loadArchiveSample();
    if (!sample) return null;

    const agg = sample.stats;
    const rates: number[] = [];
    for (const a of agg.values()) {
      if (a.n >= MIN_SENDS_PER_BRAND) rates.push(brandPerWeek(a));
    }
    if (rates.length === 0) return null;

    const indMap = industryBrandMap(sample);
    const byIndustry = topIndustries(indMap, MIN_BRANDS_PER_INDUSTRY, 6)
      .map(({ key, brandIds }) => {
        const rs: number[] = [];
        for (const id of brandIds) {
          const a = agg.get(id);
          if (a && a.n >= MIN_SENDS_PER_BRAND) rs.push(brandPerWeek(a));
        }
        return rs.length ? { industry: prettyIndustry(key), perWeek: avg(rs) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const sorted = [...byIndustry].sort((a, b) => b.perWeek - a.perWeek);

    // A month of history at least, so a launch-week burst can't top the list.
    const busiest = [...agg.entries()]
      .filter(
        ([, a]) =>
          a.n >= EXAMPLE_MIN_SENDS && a.maxMs - a.minMs >= 28 * 86_400_000
      )
      .map(([id, a]) => ({ id, value: brandPerWeek(a) }))
      .sort((a, b) => b.value - a.value);

    return {
      brandCount: rates.length,
      avgPerWeek: avg(rates),
      busiest: sorted[0] ?? null,
      calmest: sorted.length > 1 ? sorted[sorted.length - 1] : null,
      byIndustry,
      examples: await toExamples(busiest)
    };
  },
  ["docs-insights:cadence:v3"],
  { revalidate: INSIGHT_TTL }
);

/* ------------------------------- Discounts -------------------------------- */

export type DiscountInsights = {
  /** Share of a typical brand's sends that carry a discount (brand-averaged). */
  discountShare: number;
  avgDepth: number;
  maxDepth: number;
  byIndustry: { industry: string; share: number; avgDepth: number }[];
  /** Brands with the largest share of sends carrying an offer. */
  examples: ExampleBrand[];
};

export const getDiscountInsights = unstable_cache(
  async (): Promise<DiscountInsights | null> => {
    const sample = await loadArchiveSample();
    if (!sample) return null;

    const agg = sample.stats;
    const shares: number[] = [];
    for (const a of agg.values()) {
      if (a.n >= MIN_SENDS_PER_BRAND) shares.push(a.discCount / a.n);
    }
    if (shares.length === 0) return null;

    let depthSum = 0;
    let depthN = 0;
    let maxDepth = 0;
    for (const a of agg.values()) {
      depthSum += a.discDepthSum;
      depthN += a.discCount;
      if (a.discDepthMax > maxDepth) maxDepth = a.discDepthMax;
    }

    const indMap = industryBrandMap(sample);
    const byIndustry = topIndustries(indMap, MIN_BRANDS_PER_INDUSTRY, 4)
      .map(({ key, brandIds }) => {
        const localShares: number[] = [];
        let dSum = 0;
        let dN = 0;
        for (const id of brandIds) {
          const a = agg.get(id);
          if (!a || a.n < MIN_SENDS_PER_BRAND) continue;
          localShares.push(a.discCount / a.n);
          dSum += a.discDepthSum;
          dN += a.discCount;
        }
        return localShares.length
          ? {
              industry: prettyIndustry(key),
              share: Math.round(100 * avg(localShares)),
              avgDepth: dN > 0 ? Math.round(dSum / dN) : 0
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const heaviest = [...agg.entries()]
      .filter(([, a]) => a.n >= EXAMPLE_MIN_SENDS && a.discCount > 0)
      .map(([id, a]) => ({ id, value: Math.round((100 * a.discCount) / a.n) }))
      .sort((a, b) => b.value - a.value);

    return {
      discountShare: Math.round(100 * avg(shares)),
      avgDepth: depthN > 0 ? Math.round(depthSum / depthN) : 0,
      maxDepth: Math.round(maxDepth),
      byIndustry,
      examples: await toExamples(heaviest)
    };
  },
  ["docs-insights:discount:v3"],
  { revalidate: INSIGHT_TTL }
);

/* ------------------------------ Content mix ------------------------------- */

export type ContentMixInsights = {
  /** Campaign emails counted (excludes welcome). */
  sampleSize: number;
  top: { label: string; share: number };
  second: { label: string; share: number } | null;
  /** Share of campaigns that are outright sales. */
  saleShare: number;
  /** Top campaign types by share of all campaign sends. */
  ranking: { label: string; share: number }[];
  byIndustry: { industry: string; topType: string; share: number }[];
  /** The highest-volume brands and the campaign type each leads with. */
  examples: ExampleBrand[];
};

export const getContentMixInsights = unstable_cache(
  async (): Promise<ContentMixInsights | null> => {
    const sample = await loadArchiveSample();
    if (!sample) return null;

    const counts = new Map<string, number>();
    const brandCounts = new Map<string, Map<string, number>>();
    let total = 0;
    for (const [id, a] of sample.stats) {
      for (const [cat, c] of a.categories) {
        if (!cat || NON_CAMPAIGN_CATEGORIES.has(cat as EmailCategory)) continue;
        counts.set(cat, (counts.get(cat) ?? 0) + c);
        total += c;
        let own = brandCounts.get(id);
        if (!own) {
          own = new Map();
          brandCounts.set(id, own);
        }
        own.set(cat, (own.get(cat) ?? 0) + c);
      }
    }
    if (total === 0) return null;

    const ranking = [...counts.entries()]
      .map(([id, c]) => ({ id, label: categoryLabel(id), share: Math.round((100 * c) / total) }))
      .sort((a, b) => b.share - a.share);

    const indMap = industryBrandMap(sample);

    // Per-industry leading campaign type, computed over campaign sends only.
    const byIndustry = topIndustries(indMap, MIN_BRANDS_PER_INDUSTRY, 4)
      .map(({ key, brandIds }) => {
        // brandCounts already holds campaign sends only.
        const local = new Map<string, number>();
        let n = 0;
        for (const id of brandIds) {
          const own = brandCounts.get(id);
          if (!own) continue;
          for (const [cat, c] of own) {
            local.set(cat, (local.get(cat) ?? 0) + c);
            n += c;
          }
        }
        let top: string | null = null;
        let best = -1;
        for (const [cat, c] of local) {
          if (c > best) {
            best = c;
            top = cat;
          }
        }
        return top && n > 0
          ? { industry: prettyIndustry(key), topType: categoryLabel(top), share: Math.round((100 * best) / n) }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const saleEntry = ranking.find((r) => r.label === categoryLabel("sale"));

    const leading = [...brandCounts.entries()]
      .map(([id, own]) => {
        let n = 0;
        let top = "";
        let best = 0;
        for (const [cat, c] of own) {
          n += c;
          if (c > best) {
            best = c;
            top = cat;
          }
        }
        return { id, n, top, share: n > 0 ? Math.round((100 * best) / n) : 0 };
      })
      .filter((b) => b.n >= EXAMPLE_MIN_SENDS && b.top)
      .sort((a, b) => b.n - a.n)
      .map((b) => ({ id: b.id, value: b.share, label: categoryLabel(b.top) }));

    return {
      sampleSize: total,
      top: { label: ranking[0].label, share: ranking[0].share },
      second: ranking[1] ? { label: ranking[1].label, share: ranking[1].share } : null,
      saleShare: saleEntry?.share ?? 0,
      ranking: ranking.slice(0, 6).map(({ label, share }) => ({ label, share })),
      byIndustry,
      examples: await toExamples(leading)
    };
  },
  ["docs-insights:content-mix:v3"],
  { revalidate: INSIGHT_TTL }
);
