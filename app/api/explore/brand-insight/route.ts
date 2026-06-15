import { NextResponse } from "next/server";
import { getBrandPageData } from "@/lib/brand-db";
import { weeklySendRate } from "@/lib/comparison-insights";
import { ESP_LABELS } from "@/lib/admin-types";
import { pickBrandFonts } from "@/lib/brand-fonts";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

/**
 * GET `/api/explore/brand-insight?companyId=<uuid>`
 *
 * Public, no-auth brand intelligence for the homepage teaser. Wraps the same
 * `getBrandPageData` aggregation the in-app brand dashboard uses (send-hour
 * concentration, weekly cadence, discount habit, ESP share, category mix,
 * GIF adoption) and adds a cohort benchmark so the UI can say "X× the average
 * across the brands we track". Every number is real — derived from captured
 * emails — so the depth grows automatically as the archive fills.
 */

const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const pct = (x: number) => Math.round(x * 100);
const round1 = (x: number) => Math.round(x * 10) / 10;

type Bench = {
  perWeek: number;
  discountShare: number;
  brands: number;
  label: string;
  scope: "category" | "all";
};

/**
 * Average weekly send-rate and discount share across the curated cohort —
 * the brand's own market when there are enough peers, otherwise all tracked
 * brands. Computed from a single light column scan, not per-peer aggregation.
 */
async function cohortBenchmark(
  admin: SupabaseClient<Database>,
  markets: string[]
): Promise<Bench | null> {
  const market = (markets ?? []).filter(Boolean);
  let ids: string[] = [];
  let label = "the brands we track";
  let scope: "category" | "all" = "all";

  // Benchmarks reflect the WHOLE archive (not just curated brands) so the
  // numbers represent our real scale — even though we only surface emails from
  // curated brands.
  if (market.length) {
    const { data } = await admin
      .from("companies")
      .select("id")
      .is("deleted_at", null)
      .overlaps("markets", market);
    if ((data?.length ?? 0) >= 8) {
      ids = (data ?? []).map((r) => r.id);
      label = `${market[0]} brands`;
      scope = "category";
    }
  }

  if (ids.length === 0) {
    const { data } = await admin
      .from("companies")
      .select("id")
      .is("deleted_at", null);
    ids = (data ?? []).map((r) => r.id);
  }
  if (ids.length === 0) return null;

  const { data: rows } = await admin
    .from("captured_emails")
    .select("company_id, received_at, discount_percent")
    .in("company_id", ids)
    .is("duplicate_of", null)
    .order("received_at", { ascending: false })
    .limit(40000);

  const by = new Map<string, { n: number; disc: number; min: number; max: number }>();
  for (const r of rows ?? []) {
    if (!r.company_id) continue;
    const b = by.get(r.company_id) ?? { n: 0, disc: 0, min: Infinity, max: -Infinity };
    b.n++;
    if ((r.discount_percent ?? 0) > 0) b.disc++;
    const t = new Date(r.received_at).getTime();
    if (t < b.min) b.min = t;
    if (t > b.max) b.max = t;
    by.set(r.company_id, b);
  }

  const rates: number[] = [];
  const shares: number[] = [];
  for (const b of by.values()) {
    if (b.n < 4) continue;
    // Clamp the active span to ≥7 days (matching the per-brand weeklySendRate
    // window) so a brand with a few sends over a couple of days doesn't read as
    // "10 emails/week", while keeping the benchmark comparable to each brand's
    // own rate.
    const days = Math.max(7, (b.max - b.min) / 86_400_000);
    rates.push((7 * b.n) / days);
    shares.push((100 * b.disc) / b.n);
  }
  if (rates.length === 0) return null;

  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return {
    perWeek: avg(rates),
    discountShare: avg(shares),
    brands: rates.length,
    label,
    scope,
  };
}

const COUNTRY_NAMES: Record<string, string> = {
  DK: "Denmark",
  SE: "Sweden",
  NO: "Norway",
  FI: "Finland",
  GB: "the UK",
  US: "the US",
  DE: "Germany",
  FR: "France",
  NL: "the Netherlands",
};

/**
 * Top ESPs (by brand) across the curated cohort. Tries the brand's own market +
 * country first, then widens (market only, then all tracked brands) until there
 * are enough peers — and reports which scope it landed on.
 */
async function espCohort(
  admin: SupabaseClient<Database>,
  markets: string[],
  country: string | null,
  thisLabel: string | null
) {
  const m = (markets ?? []).filter(Boolean);
  const attempts: { markets: string[] | null; country: string | null; scope: string }[] = [];
  if (m.length && country) {
    attempts.push({ markets: m, country, scope: `${m[0]} · ${COUNTRY_NAMES[country] ?? country}` });
  }
  if (m.length) attempts.push({ markets: m, country: null, scope: `${m[0]} brands` });
  attempts.push({ markets: null, country: null, scope: "the brands we track" });

  for (const a of attempts) {
    // The "field" spans the WHOLE archive, not just curated brands, so it
    // reflects our real scale (hundreds of brands), not the handful we surface.
    let q = admin.from("companies").select("id").is("deleted_at", null);
    if (a.markets) q = q.overlaps("markets", a.markets);
    if (a.country) q = q.eq("primary_market_country", a.country);
    const { data: comps } = await q;
    const ids = (comps ?? []).map((c) => c.id);
    if (ids.length < 6) continue;

    const { data: rows } = await admin
      .from("captured_emails")
      .select("company_id, esp_provider")
      .in("company_id", ids)
      .is("duplicate_of", null)
      .not("esp_provider", "is", null)
      .limit(20000);

    const byBrand = new Map<string, Map<string, number>>();
    for (const r of rows ?? []) {
      if (!r.company_id || !r.esp_provider) continue;
      let mm = byBrand.get(r.company_id);
      if (!mm) {
        mm = new Map();
        byBrand.set(r.company_id, mm);
      }
      mm.set(r.esp_provider, (mm.get(r.esp_provider) ?? 0) + 1);
    }
    if (byBrand.size < 5) continue;

    const espBrands = new Map<string, number>();
    for (const mm of byBrand.values()) {
      let top: string | null = null;
      let tc = -1;
      for (const [esp, c] of mm) if (c > tc) { tc = c; top = esp; }
      if (top) espBrands.set(top, (espBrands.get(top) ?? 0) + 1);
    }

    const items = [...espBrands.entries()]
      .map(([esp, c]) => ({ label: ESP_LABELS[esp as keyof typeof ESP_LABELS] ?? esp, count: c }))
      .sort((a2, b2) => b2.count - a2.count)
      .slice(0, 5)
      .map((it) => ({ ...it, isThis: it.label === thisLabel }));
    if (items.length) return { brands: byBrand.size, scope: a.scope, items };
  }
  return null;
}

/** Bucket a brand's sample into the last 10 weeks: send + discount frequency + depth. */
function weeklyDiscounts(
  sample: { receivedAt: string; discountPercent: number | null }[],
  nowMs: number
) {
  const WEEKS = 10;
  const buckets = Array.from({ length: WEEKS }, () => ({ sends: 0, discountSends: 0, depthSum: 0 }));
  for (const e of sample ?? []) {
    const wi = Math.floor((nowMs - new Date(e.receivedAt).getTime()) / (7 * 86_400_000));
    if (wi < 0 || wi >= WEEKS) continue;
    const b = buckets[wi];
    b.sends++;
    if ((e.discountPercent ?? 0) > 0) {
      b.discountSends++;
      b.depthSum += e.discountPercent ?? 0;
    }
  }
  return buckets
    .map((b) => ({
      sends: b.sends,
      discountSends: b.discountSends,
      avgDepth: b.discountSends > 0 ? Math.round(b.depthSum / b.discountSends) : 0,
    }))
    .reverse();
}

export async function GET(request: Request) {
  const companyId = new URL(request.url).searchParams.get("companyId");
  if (!companyId || !UUID.test(companyId)) {
    return NextResponse.json({ insight: null }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  let brand;
  try {
    brand = await getBrandPageData(admin, companyId);
  } catch (error) {
    console.error("[brand-insight] aggregation failed", error);
    return NextResponse.json({ insight: null }, { status: 200 });
  }
  if (!brand) return NextResponse.json({ insight: null }, { status: 200 });

  const perWeek = weeklySendRate(brand);
  const bench = await cohortBenchmark(admin, brand.brand.markets);
  const sample = brand.totals.sampleSize || 1;
  const topCat = brand.categories[0]
    ? {
        label: brand.categories[0].label,
        share: Math.round((100 * brand.categories[0].count) / sample),
      }
    : null;
  const topCta = brand.ctas[0]
    ? {
        text: brand.ctas[0].text,
        share: Math.round((100 * brand.ctas[0].count) / sample),
        distinct: brand.ctas.length,
      }
    : null;

  const insight = {
    emailCount: brand.totals.emailCount,
    perWeek: round1(perWeek),
    benchmarkPerWeek: bench ? round1(bench.perWeek) : null,
    benchmarkLabel: bench?.label ?? "the brands we track",
    typicalHour: brand.cadence.typicalHour
      ? { label: brand.cadence.typicalHour.label, share: pct(brand.cadence.typicalHour.share) }
      : null,
    esp: brand.esp.primary
      ? { label: brand.esp.primary.label, share: pct(brand.esp.primary.share) }
      : null,
    discountShare: pct(brand.promo.discountShare),
    avgDiscount: brand.promo.avgDiscount != null ? Math.round(brand.promo.avgDiscount) : null,
    maxDiscount: brand.promo.maxDiscount != null ? Math.round(brand.promo.maxDiscount) : null,
    topCategory: topCat,
    topCta,
    gifShare: pct(brand.design.gifShare),
    darkModeShare: pct(brand.design.darkModeShare),
    figures: {
      hourly: brand.cadence.hourly,
      categories: brand.categories
        .slice(0, 6)
        .map((c) => ({ label: c.label, share: Math.round((100 * c.count) / sample) })),
      ctas: brand.ctas
        .slice(0, 5)
        .map((c) => ({ text: c.text, share: Math.round((100 * c.count) / sample) })),
      palette: brand.design.palette.slice(0, 8),
      fonts: pickBrandFonts(brand.design.fonts, 5),
      weeklyDiscounts: weeklyDiscounts(brand.seasonalSample, Date.now()),
      espCohort: await espCohort(
        admin,
        brand.brand.markets,
        brand.brand.primaryMarketCountry,
        brand.esp.primary?.label ?? null
      ),
    },
  };

  return NextResponse.json(
    { insight },
    { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } }
  );
}
