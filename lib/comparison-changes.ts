import type { BrandPageData } from "./brand-db";

/**
 * Change detection for the comparison dashboard's "What's new in this
 * group" feed — the layer that makes a comparison worth *revisiting*.
 *
 * Every detector compares a brand against its own baseline (not the
 * group): a pace spike, an unusual silence, a discount after a long
 * dry spell. Claims are conservative — each detector has volume and
 * ratio thresholds and returns nothing rather than flag noise.
 *
 * All math anchors on the brand's daily timeline (which ends "today"
 * as of data assembly), not on `Date.now()`, so results are pure
 * functions of the payload and unit-testable with synthetic data.
 */

export type BrandChangeKind = "pace_spike" | "gone_quiet" | "first_sale";

export type BrandChange = {
  kind: BrandChangeKind;
  brandId: string;
  brandName: string;
  /** Index into the original `brands` array — keeps chart colors stable. */
  brandIndex: number;
  /** Ready-to-render sentence. */
  message: string;
  /** Cross-kind sort key; higher = more remarkable. */
  severity: number;
};

/** Sends in the most recent N days are "now". */
const RECENT_DAYS = 7;
/** Baseline window behind the recent week (12 full weeks). */
const BASELINE_DAYS = 84;

/** Formats a ratio like 3 → "3", 2.34 → "2.3". */
function fmt1(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function timelineCounts(brand: BrandPageData): number[] {
  return brand.cadence.dailyTimeline.map((day) => day.count);
}

/** Millisecond timestamp of the timeline's last day (UTC midnight of
 *  its day key) — the "now" every detector measures against. */
function anchorMs(brand: BrandPageData): number | null {
  const last = brand.cadence.dailyTimeline.at(-1);
  if (!last) return null;
  const ms = new Date(`${last.date.slice(0, 10)}T00:00:00Z`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/* ------------------------------------------------------------------ */
/* Detectors                                                           */
/* ------------------------------------------------------------------ */

/**
 * Pace spike: the recent week clearly outruns the brand's own 12-week
 * baseline. Requires a real baseline (≥1/week) and real recent volume
 * (≥4 sends) so a 0→2 blip never reads as "2× their usual pace".
 */
function detectPaceSpike(
  brand: BrandPageData,
  index: number
): BrandChange | null {
  const counts = timelineCounts(brand);
  if (counts.length < RECENT_DAYS + 28) return null;

  const recent = counts
    .slice(-RECENT_DAYS)
    .reduce((sum, count) => sum + count, 0);

  const baselineSlice = counts.slice(
    Math.max(0, counts.length - RECENT_DAYS - BASELINE_DAYS),
    counts.length - RECENT_DAYS
  );
  if (baselineSlice.length < 28) return null;
  const baselinePerWeek =
    baselineSlice.reduce((sum, count) => sum + count, 0) /
    (baselineSlice.length / 7);

  if (baselinePerWeek < 1 || recent < 4) return null;
  const ratio = recent / baselinePerWeek;
  if (ratio < 2) return null;

  return {
    kind: "pace_spike",
    brandId: brand.brand.id,
    brandName: brand.brand.name,
    brandIndex: index,
    message: `${brand.brand.name} sent ${recent} emails in the last ${RECENT_DAYS} days — about ${fmt1(ratio)}× their usual pace.`,
    severity: ratio
  };
}

/**
 * Gone quiet: an unusually long silence from a brand with an
 * established cadence. Only fires for genuinely regular senders
 * (typical gap ≤ 21 days, ≥10 emails) so a quarterly newsletter is
 * never "quiet".
 */
function detectGoneQuiet(
  brand: BrandPageData,
  index: number
): BrandChange | null {
  const typical = brand.cadence.avgDaysBetween;
  if (typical === null || typical > 21) return null;
  if (brand.totals.emailCount < 10) return null;

  const counts = timelineCounts(brand);
  if (counts.length === 0) return null;
  let silentDays = 0;
  for (let i = counts.length - 1; i >= 0 && counts[i] === 0; i--) {
    silentDays += 1;
  }
  // The whole timeline being empty means the silence predates our
  // window — the cadence average is stale, don't claim.
  if (silentDays >= counts.length) return null;

  const threshold = Math.max(10, Math.ceil(typical * 2.5));
  if (silentDays < threshold) return null;

  return {
    kind: "gone_quiet",
    brandId: brand.brand.id,
    brandName: brand.brand.name,
    brandIndex: index,
    message: `${brand.brand.name} has gone quiet — ${silentDays} days without a send (they usually send every ${Math.round(typical)} days).`,
    severity: silentDays / Math.max(1, typical)
  };
}

/** A discount counts as "fresh" within this many days of the anchor. */
const SALE_FRESH_DAYS = 7;
/** The previous discount must be at least this much older for the
 *  fresh one to be a story. */
const SALE_DRY_SPELL_DAYS = 60;

/**
 * First sale in a while: a discount email landed this week after a
 * long dry spell. When no earlier discount exists at all, the sample
 * must reach back past the dry-spell window to support a "first in N
 * months" framing — otherwise we simply can't know and stay silent.
 */
function detectFirstSale(
  brand: BrandPageData,
  index: number
): BrandChange | null {
  const anchor = anchorMs(brand);
  if (anchor === null) return null;

  const discounts = brand.seasonalSample
    .filter(
      (email) => email.discountPercent !== null && email.discountPercent > 0
    )
    .map((email) => ({
      at: new Date(email.receivedAt).getTime(),
      percent: email.discountPercent as number
    }))
    .filter((email) => !Number.isNaN(email.at))
    .sort((a, b) => b.at - a.at);
  if (discounts.length === 0) return null;

  const latest = discounts[0];
  const daysAgo = Math.max(0, (anchor - latest.at) / 86_400_000);
  if (daysAgo > SALE_FRESH_DAYS) return null;

  let gapDays: number;
  if (discounts.length >= 2) {
    gapDays = (latest.at - discounts[1].at) / 86_400_000;
  } else {
    const oldestAt = Math.min(
      ...brand.seasonalSample
        .map((email) => new Date(email.receivedAt).getTime())
        .filter((ms) => !Number.isNaN(ms))
    );
    gapDays = (latest.at - oldestAt) / 86_400_000;
  }
  if (gapDays < SALE_DRY_SPELL_DAYS) return null;

  const months = Math.max(2, Math.round(gapDays / 30));
  return {
    kind: "first_sale",
    brandId: brand.brand.id,
    brandName: brand.brand.name,
    brandIndex: index,
    message: `${brand.brand.name} just dropped their first discount in about ${months} months (${Math.round(latest.percent)}% off).`,
    severity: 3 + months / 12
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

const MAX_CHANGES = 6;

export function detectBrandChanges(
  brand: BrandPageData,
  index: number
): BrandChange[] {
  const changes: BrandChange[] = [];
  const spike = detectPaceSpike(brand, index);
  if (spike) changes.push(spike);
  const quiet = detectGoneQuiet(brand, index);
  if (quiet) changes.push(quiet);
  const sale = detectFirstSale(brand, index);
  if (sale) changes.push(sale);
  return changes;
}

/** Every change across the group, most remarkable first, capped so the
 *  feed stays a headline strip rather than a wall. */
export function detectGroupChanges(brands: BrandPageData[]): BrandChange[] {
  const all = brands.flatMap((brand, index) =>
    detectBrandChanges(brand, index)
  );
  all.sort((a, b) => b.severity - a.severity);
  return all.slice(0, MAX_CHANGES);
}
