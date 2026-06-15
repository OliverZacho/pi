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
 * (`revalidate`), so a single light scan refreshes for everyone every ~30 min.
 *
 * Resilience: a load failure returns `null`/empty, never throws — the article
 * page falls back to neutral prose instead of a 500.
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  EMAIL_CATEGORY_LABELS,
  ESP_LABELS,
  type EmailCategory,
  type EspProvider
} from "@/lib/admin-types";
import {
  formatHourOfDay,
  getActiveTimeZone,
  getZonedParts
} from "@/lib/datetime";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/** Rows aggregated per scan. Generous — the math is linear and cached. */
const SCAN_CAP = 40000;
/** A brand needs at least this many sends to count toward a benchmark. */
const MIN_SENDS_PER_BRAND = 4;
/** An industry needs at least this many brands before we quote it. */
const MIN_BRANDS_PER_INDUSTRY = 6;
/** How long a computed benchmark is cached across requests (seconds). */
const INSIGHT_TTL = 1800;

type SampleRow = {
  companyId: string;
  receivedAt: string;
  esp: string | null;
  /** Discount percent in (0, 100]; `null` for non-promo or out-of-range. */
  discount: number | null;
  /** Classified email type (e.g. "sale", "products"); "" when unclassified. */
  category: string;
};

type BrandMeta = { markets: string[]; country: string | null };

type ArchiveSample = {
  rows: SampleRow[];
  /** Tracked-brand id → its industry tags + primary country. */
  brands: Map<string, BrandMeta>;
  /** Total tracked brands (not soft-deleted). */
  brandCount: number;
  /** Exact total captured (de-duped) emails — from a head count, not the cap. */
  emailCount: number;
};

/**
 * Loads the shared archive slice once per render (React `cache` dedups it across
 * the four `getX` helpers). Pulls the brand → industry map, an exact email head
 * count, and a capped, newest-first scan of de-duped sends.
 */
const loadArchiveSample = cache(async (): Promise<ArchiveSample | null> => {
  try {
    const admin = getSupabaseAdmin();
    const [companiesRes, countRes, emailsRes] = await Promise.all([
      admin
        .from("companies")
        .select("id, markets, primary_market_country")
        .is("deleted_at", null),
      admin
        .from("captured_emails")
        .select("id", { count: "exact", head: true })
        .is("duplicate_of", null),
      admin
        .from("captured_emails")
        .select("company_id, received_at, esp_provider, discount_percent, category")
        .is("duplicate_of", null)
        .order("received_at", { ascending: false })
        .limit(SCAN_CAP)
    ]);

    const companies = companiesRes.data;
    if (!companies) return null;

    const brands = new Map<string, BrandMeta>();
    for (const c of companies) {
      brands.set(c.id, {
        markets: (c.markets ?? []).filter(Boolean),
        country: c.primary_market_country ?? null
      });
    }

    const rows: SampleRow[] = [];
    for (const r of emailsRes.data ?? []) {
      if (!r.company_id) continue;
      const raw =
        r.discount_percent === null || r.discount_percent === undefined
          ? null
          : Number(r.discount_percent);
      const discount = raw !== null && raw > 0 && raw <= 100 ? raw : null;
      rows.push({
        companyId: r.company_id,
        receivedAt: r.received_at,
        esp: r.esp_provider,
        discount,
        category: r.category ?? ""
      });
    }

    return {
      rows,
      brands,
      brandCount: brands.size,
      emailCount: countRes.count ?? rows.length
    };
  } catch (error) {
    console.error("[docs/insights] sample load failed", error);
    return null;
  }
});

/* ----------------------------- shared helpers ----------------------------- */

type BrandAgg = {
  n: number;
  espCounts: Map<string, number>;
  discCount: number;
  discDepthSum: number;
  minMs: number;
  maxMs: number;
};

/** One pass over the sample, rolled up per brand. */
function buildBrandAgg(sample: ArchiveSample): Map<string, BrandAgg> {
  const agg = new Map<string, BrandAgg>();
  for (const row of sample.rows) {
    let a = agg.get(row.companyId);
    if (!a) {
      a = {
        n: 0,
        espCounts: new Map(),
        discCount: 0,
        discDepthSum: 0,
        minMs: Infinity,
        maxMs: -Infinity
      };
      agg.set(row.companyId, a);
    }
    a.n += 1;
    if (row.esp) a.espCounts.set(row.esp, (a.espCounts.get(row.esp) ?? 0) + 1);
    if (row.discount !== null) {
      a.discCount += 1;
      a.discDepthSum += row.discount;
    }
    const t = new Date(row.receivedAt).getTime();
    if (!Number.isNaN(t)) {
      if (t < a.minMs) a.minMs = t;
      if (t > a.maxMs) a.maxMs = t;
    }
  }
  return agg;
}

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
};

export const getEspInsights = unstable_cache(
  async (): Promise<EspInsights | null> => {
  const sample = await loadArchiveSample();
  if (!sample) return null;

  const agg = buildBrandAgg(sample);
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

  return {
    brandCount: sample.brandCount,
    espBrandCount: total,
    top: ranking[0],
    second: ranking[1] ?? null,
    ranking,
    byIndustry
  };
  },
  ["docs-insights:esp"],
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
};

export const getSendTimeInsights = unstable_cache(
  async (): Promise<SendTimeInsights | null> => {
    const sample = await loadArchiveSample();
    if (!sample) return null;

    const zone = getActiveTimeZone();
    const hourly = new Array<number>(24).fill(0);
    const indHourly = new Map<string, number[]>();

    for (const row of sample.rows) {
      let hour: number;
      try {
        hour = getZonedParts(row.receivedAt, zone).hour;
      } catch {
        continue;
      }
      hourly[hour] += 1;
      const meta = sample.brands.get(row.companyId);
      if (!meta) continue;
      for (const tag of meta.markets) {
        let arr = indHourly.get(tag);
        if (!arr) {
          arr = new Array<number>(24).fill(0);
          indHourly.set(tag, arr);
        }
        arr[hour] += 1;
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

    return {
      sendCount: totalSends,
      peak: { label: label(peakH), share: Math.round((100 * hourly[peakH]) / totalSends) },
      peakHour: peakH,
      hourly,
      morningShare: windowShare(6, 11),
      afternoonShare: windowShare(12, 16),
      eveningShare: windowShare(17, 21),
      topHours,
      byIndustry
    };
  },
  ["docs-insights:send-time"],
  { revalidate: INSIGHT_TTL }
);

/* -------------------------------- Cadence --------------------------------- */

export type CadenceInsights = {
  brandCount: number;
  avgPerWeek: number;
  busiest: { industry: string; perWeek: number } | null;
  calmest: { industry: string; perWeek: number } | null;
  byIndustry: { industry: string; perWeek: number }[];
};

export const getCadenceInsights = unstable_cache(
  async (): Promise<CadenceInsights | null> => {
    const sample = await loadArchiveSample();
    if (!sample) return null;

    const agg = buildBrandAgg(sample);
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

    return {
      brandCount: rates.length,
      avgPerWeek: avg(rates),
      busiest: sorted[0] ?? null,
      calmest: sorted.length > 1 ? sorted[sorted.length - 1] : null,
      byIndustry
    };
  },
  ["docs-insights:cadence"],
  { revalidate: INSIGHT_TTL }
);

/* ------------------------------- Discounts -------------------------------- */

export type DiscountInsights = {
  /** Share of a typical brand's sends that carry a discount (brand-averaged). */
  discountShare: number;
  avgDepth: number;
  maxDepth: number;
  byIndustry: { industry: string; share: number; avgDepth: number }[];
};

export const getDiscountInsights = unstable_cache(
  async (): Promise<DiscountInsights | null> => {
    const sample = await loadArchiveSample();
    if (!sample) return null;

    const agg = buildBrandAgg(sample);
    const shares: number[] = [];
    for (const a of agg.values()) {
      if (a.n >= MIN_SENDS_PER_BRAND) shares.push(a.discCount / a.n);
    }
    if (shares.length === 0) return null;

    let depthSum = 0;
    let depthN = 0;
    let maxDepth = 0;
    for (const row of sample.rows) {
      if (row.discount === null) continue;
      depthSum += row.discount;
      depthN += 1;
      if (row.discount > maxDepth) maxDepth = row.discount;
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

    return {
      discountShare: Math.round(100 * avg(shares)),
      avgDepth: depthN > 0 ? Math.round(depthSum / depthN) : 0,
      maxDepth: Math.round(maxDepth),
      byIndustry
    };
  },
  ["docs-insights:discount"],
  { revalidate: INSIGHT_TTL }
);

/* ------------------------------ Content mix ------------------------------- */

/**
 * Triggered / lifecycle types are excluded so the mix reflects *broadcast
 * campaigns* a brand chooses to send — not the welcome mail our own
 * subscription reliably triggers, which would otherwise dominate the share.
 */
const NON_CAMPAIGN = new Set(["welcome", "transactional"]);

export type ContentMixInsights = {
  /** Campaign emails counted (excludes welcome/transactional). */
  sampleSize: number;
  top: { label: string; share: number };
  second: { label: string; share: number } | null;
  /** Share of campaigns that are outright sales. */
  saleShare: number;
  /** Top campaign types by share of all campaign sends. */
  ranking: { label: string; share: number }[];
  byIndustry: { industry: string; topType: string; share: number }[];
};

export const getContentMixInsights = unstable_cache(
  async (): Promise<ContentMixInsights | null> => {
    const sample = await loadArchiveSample();
    if (!sample) return null;

    const counts = new Map<string, number>();
    let total = 0;
    for (const row of sample.rows) {
      const cat = row.category;
      if (!cat || NON_CAMPAIGN.has(cat)) continue;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
      total += 1;
    }
    if (total === 0) return null;

    const ranking = [...counts.entries()]
      .map(([id, c]) => ({ id, label: categoryLabel(id), share: Math.round((100 * c) / total) }))
      .sort((a, b) => b.share - a.share);

    const indMap = industryBrandMap(sample);

    // Per-industry leading campaign type, computed over campaign sends only.
    const byIndustry = topIndustries(indMap, MIN_BRANDS_PER_INDUSTRY, 4)
      .map(({ key, brandIds }) => {
        const ids = new Set(brandIds);
        const local = new Map<string, number>();
        let n = 0;
        for (const row of sample.rows) {
          if (!ids.has(row.companyId)) continue;
          const cat = row.category;
          if (!cat || NON_CAMPAIGN.has(cat)) continue;
          local.set(cat, (local.get(cat) ?? 0) + 1);
          n += 1;
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

    return {
      sampleSize: total,
      top: { label: ranking[0].label, share: ranking[0].share },
      second: ranking[1] ? { label: ranking[1].label, share: ranking[1].share } : null,
      saleShare: saleEntry?.share ?? 0,
      ranking: ranking.slice(0, 6).map(({ label, share }) => ({ label, share })),
      byIndustry
    };
  },
  ["docs-insights:content-mix"],
  { revalidate: INSIGHT_TTL }
);
