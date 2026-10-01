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
 * Average weekly send-rate and discount share across the cohort: the brand's
 * own market when there are enough peers, otherwise all tracked brands.
 * Aggregated in SQL (brand_cohort_benchmark) over the WHOLE archive, not just
 * curated brands, so the numbers represent our real scale even though we only
 * surface emails from curated brands. It used to scan rows into the route,
 * which PostgREST cut off at the newest 1,000 sends.
 */
async function cohortBenchmark(
  admin: SupabaseClient<Database>,
  markets: string[]
): Promise<Bench | null> {
  const market = (markets ?? []).filter(Boolean);
  const { data, error } = await admin.rpc("brand_cohort_benchmark", {
    p_markets: market.length ? market : undefined,
  });
  if (error) {
    console.error("[brand-insight] cohort benchmark failed", error);
    return null;
  }
  const row = data as {
    scope: "category" | "all";
    brands: number;
    per_week: number | null;
    discount_share: number | null;
  } | null;
  if (!row || !row.brands || row.per_week == null) return null;

  return {
    perWeek: Number(row.per_week),
    discountShare: Number(row.discount_share ?? 0),
    brands: row.brands,
    label: row.scope === "category" ? `${market[0]} brands` : "the brands we track",
    scope: row.scope,
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
    // Each brand's top ESP is picked in SQL (esp_cohort_shares).
    const { data, error } = await admin.rpc("esp_cohort_shares", {
      p_markets: a.markets ?? undefined,
      p_country: a.country ?? undefined,
    });
    if (error) {
      console.error("[brand-insight] ESP cohort failed", error);
      return null;
    }
    const cohort = data as {
      companies: number;
      brands: number;
      items: { esp: string; brands: number }[];
    } | null;
    if (!cohort || cohort.companies < 6 || cohort.brands < 5) continue;

    const items = cohort.items
      .slice(0, 5)
      .map((it) => {
        const label = ESP_LABELS[it.esp as keyof typeof ESP_LABELS] ?? it.esp;
        return { label, count: it.brands, isThis: label === thisLabel };
      });
    if (items.length) return { brands: cohort.brands, scope: a.scope, items };
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
