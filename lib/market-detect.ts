import { getSupabaseAdmin } from "./supabase-admin";

/**
 * Brand-level market rollup.
 *
 * Each captured email carries a best-effort `detected_country` (see
 * `classify.ts`). This module aggregates those per-email picks into a single
 * `primary_market_country` per brand so peer comparisons (send time, cadence)
 * stay within one audience.
 *
 * The rollup is a confidence- and recency-weighted vote:
 *  - each email contributes `country_confidence × recencyWeight` to its country,
 *  - recency decays with a half-life so a brand that recently pivoted markets
 *    (or a brand we mislabelled early on) is corrected as fresh mail lands,
 *  - we only commit a country when one clearly dominates; otherwise we store
 *    NULL ("unknown") rather than guess, matching the per-email policy.
 */

// Only the most recent emails matter, and reading the whole history on every
// ingest is wasteful. A brand's market is stable over this window.
const ROLLUP_EMAIL_LIMIT = 300;
// Recency half-life: an email this many days old counts for half a fresh one.
const RECENCY_HALF_LIFE_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// The winning country must hold at least this share of total weight, else the
// brand stays "unknown". Keeps genuinely split / ambiguous brands out.
const DOMINANCE_THRESHOLD = 0.6;

export type MarketRollup = {
  country: string | null;
  confidence: number | null;
  emailsConsidered: number;
};

type CountryRow = {
  detected_country: string | null;
  country_confidence: number | string | null;
  received_at: string | null;
};

/**
 * Recomputes and persists a company's primary market from its emails' detected
 * countries. Returns the rollup that was written. Safe to call after every
 * ingest — it's a bounded read + single update.
 */
export async function recomputeCompanyMarket(companyId: string): Promise<MarketRollup> {
  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin
    .from("captured_emails")
    .select("detected_country, country_confidence, received_at")
    .eq("company_id", companyId)
    .not("detected_country", "is", null)
    .order("received_at", { ascending: false })
    .limit(ROLLUP_EMAIL_LIMIT);

  if (error) {
    throw new Error(`recomputeCompanyMarket read failed: ${error.message}`);
  }

  const rollup = rollupCountries((data ?? []) as CountryRow[]);

  const { error: updateError } = await supabaseAdmin
    .from("companies")
    .update({
      primary_market_country: rollup.country,
      market_confidence: rollup.confidence
    })
    .eq("id", companyId);

  if (updateError) {
    throw new Error(`recomputeCompanyMarket write failed: ${updateError.message}`);
  }

  return rollup;
}

/**
 * Pure vote tallier, split out so it's unit-testable without a database. Weighs
 * each email by its own country confidence and by how recent it is, then returns
 * the dominant country when it clears {@link DOMINANCE_THRESHOLD}.
 */
export function rollupCountries(
  rows: CountryRow[],
  now: number = Date.now()
): MarketRollup {
  const weightByCountry = new Map<string, number>();
  let totalWeight = 0;
  let considered = 0;

  for (const row of rows) {
    const country = typeof row.detected_country === "string" ? row.detected_country : null;
    if (!country) {
      continue;
    }
    const confidence = clamp01(toNumber(row.country_confidence) ?? 1);
    if (confidence <= 0) {
      continue;
    }
    const weight = confidence * recencyWeight(row.received_at, now);
    if (weight <= 0) {
      continue;
    }
    weightByCountry.set(country, (weightByCountry.get(country) ?? 0) + weight);
    totalWeight += weight;
    considered += 1;
  }

  if (totalWeight <= 0) {
    return { country: null, confidence: null, emailsConsidered: considered };
  }

  let topCountry: string | null = null;
  let topWeight = 0;
  for (const [country, weight] of weightByCountry) {
    if (weight > topWeight) {
      topCountry = country;
      topWeight = weight;
    }
  }

  const share = topWeight / totalWeight;
  if (!topCountry || share < DOMINANCE_THRESHOLD) {
    return { country: null, confidence: null, emailsConsidered: considered };
  }

  return {
    country: topCountry,
    confidence: roundTo(share, 3),
    emailsConsidered: considered
  };
}

function recencyWeight(receivedAt: string | null, now: number): number {
  if (!receivedAt) {
    return 1;
  }
  const ts = Date.parse(receivedAt);
  if (!Number.isFinite(ts)) {
    return 1;
  }
  const ageDays = Math.max(0, (now - ts) / MS_PER_DAY);
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

function toNumber(value: number | string | null): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
