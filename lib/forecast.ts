import type { BrandPageData } from "./brand-db";
import {
  addDaysInZone,
  formatDayKey,
  getActiveTimeZone,
  getZonedParts,
  parseDayKey,
  startOfDayInZone,
  type TimeZone
} from "./datetime";

/**
 * Forecast helpers powering the "Predicted inbox crowding" panel on the
 * compare dashboard.
 *
 * We want a simple, defensible model — not a black-box ML pipeline —
 * because the value to the user comes from *explaining* the upcoming
 * week, not from squeezing the last few % of accuracy out of noisy
 * marketing-email cadence data. So the predictor is a textbook
 * **time-decayed seasonal-naive** estimator:
 *
 *   1. Walk each brand's `dailyTimeline` (365 days ending today, in
 *      the platform zone — see {@link BrandPageData.cadence.dailyTimeline}).
 *   2. For each entry, compute a weight `exp(-age_days / DECAY_DAYS)`
 *      so recent behaviour dominates the estimate but a brand with
 *      only old activity still produces a non-zero baseline.
 *   3. Bucket weighted counts + weights by day-of-week (0=Sun … 6=Sat
 *      in the platform zone — same convention as {@link getZonedParts}).
 *   4. The per-(brand, weekday) point estimate is the weighted mean
 *      of historical sends on that weekday.
 *   5. For each future date in the horizon we sum those per-brand
 *      estimates to get the cohort-wide expected volume, and we tag
 *      each day as `quiet` / `normal` / `busy` against the horizon
 *      average so the UI can colour-code at a glance.
 *
 * Why this and not something fancier?
 *   - Holidays / promo bursts dominate real send data and would force
 *     us into bespoke event detection that we don't have signal for.
 *   - Most brands have a strong day-of-week rhythm (Tue/Thu sends
 *     dwarf weekends in B2C retail) — DOW seasonality captures the
 *     biggest source of variance with one tunable parameter.
 *   - The model is auditable: the per-day breakdown can be explained
 *     ("Acme typically sends 0.8 emails on Wednesdays"), which is
 *     critical for a planning tool where the user has to trust the
 *     recommendation.
 */

/** How quickly old observations decay (e-folding in days). 30 days
 *  is the sweet spot for marketing-email cadence: a 30-day-old
 *  observation still carries ~37% of a fresh one, a quarter-old
 *  observation drops to ~6%, but a brand that has only ever sent on
 *  Tuesdays still produces a believable Tuesday baseline. Anything
 *  tighter overfits on the last fortnight and recommends days based
 *  on noise; anything looser dilutes recent strategic pivots (e.g.
 *  a brand that just moved its weekly drop from Wed to Thu). Exposed
 *  for tests. */
export const FORECAST_DECAY_DAYS = 30;

/** Bands used to label a forecasted day relative to the horizon's
 *  average expected volume. Tuned so the labels match a user's
 *  intuition: ~30% above/below the mean reads as a real spike/dip. */
export const FORECAST_BUSY_RATIO = 1.3;
export const FORECAST_QUIET_RATIO = 0.7;

export type ForecastHorizon = 7 | 14;

export type ForecastDayBand = "quiet" | "normal" | "busy";

export type BrandContribution = {
  brandId: string;
  brandName: string;
  /** Continuous expected count from the seasonal-naive model (e.g.
   *  0.8 means "this brand sends on roughly 4 in 5 Wednesdays"). */
  expected: number;
};

export type ForecastDay = {
  /** `YYYY-MM-DD` in the platform zone. */
  date: string;
  /** 0 = Sunday … 6 = Saturday, matching {@link getZonedParts}. */
  weekday: number;
  /** 0-indexed offset from today (1 = tomorrow, 7 = one week out). */
  daysAhead: number;
  /** Cohort-wide expected send count for this day. */
  expected: number;
  /** Per-brand contributions, sorted by descending expected value. */
  contributions: BrandContribution[];
  /** Categorical band against the horizon mean. */
  band: ForecastDayBand;
};

export type CohortForecast = {
  horizon: ForecastHorizon;
  /** Day-by-day prediction, chronological (tomorrow → horizon end). */
  days: ForecastDay[];
  /** Mean expected volume across `days`, used as the band reference. */
  mean: number;
  /** Max expected volume across `days`, used for bar scaling. */
  max: number;
  /** Strongest "quiet" and "busy" days — `null` when the cohort has
   *  no signal at all (every brand empty). */
  quietest: ForecastDay | null;
  busiest: ForecastDay | null;
  /** How much usable signal the model had to work with: total weight
   *  summed across every (brand, weekday) bucket. The UI uses this to
   *  hide the panel entirely on cohorts that don't have enough sends
   *  to make a meaningful prediction. */
  totalWeight: number;
};

/**
 * Builds the cohort-wide forecast for the next {@link horizon} days.
 *
 * `now` is an injection point for tests — production code should
 * always call this without an argument so the model sees the real
 * platform "today".
 */
export function computeCohortForecast(
  brands: BrandPageData[],
  horizon: ForecastHorizon,
  now: Date = new Date(),
  zone: TimeZone = getActiveTimeZone()
): CohortForecast {
  if (brands.length === 0) {
    // No cohort = nothing to predict. The dashboard already shows the
    // "pick at least one brand" empty state in this case, but other
    // callers (and tests) prefer an explicit empty result over seven
    // zeroed-out placeholder days.
    return {
      horizon,
      days: [],
      mean: 0,
      max: 0,
      quietest: null,
      busiest: null,
      totalWeight: 0
    };
  }

  const todayStart = startOfDayInZone(now, zone);

  // Per-brand DOW estimators. `weights[d]` and `weighted[d]` keep the
  // running sums so we can read out the weighted mean in one division
  // at the end. Pre-allocating 7-length arrays keeps the inner loops
  // branch-free.
  const perBrand = brands.map((b) => ({
    id: b.brand.id,
    name: b.brand.name,
    perWeekday: buildWeekdayEstimator(
      b.cadence.dailyTimeline,
      todayStart,
      zone
    )
  }));

  let totalWeight = 0;
  for (const brand of perBrand) {
    for (let i = 0; i < 7; i++) totalWeight += brand.perWeekday.weight[i];
  }

  const days: ForecastDay[] = [];
  for (let offset = 1; offset <= horizon; offset++) {
    const target = addDaysInZone(todayStart, offset, zone);
    const weekday = getZonedParts(target, zone).weekday;

    const contributions: BrandContribution[] = [];
    let expected = 0;
    for (const brand of perBrand) {
      const value = readEstimate(brand.perWeekday, weekday);
      expected += value;
      contributions.push({
        brandId: brand.id,
        brandName: brand.name,
        expected: value
      });
    }
    contributions.sort((a, b) => b.expected - a.expected);

    days.push({
      date: formatDayKey(target, zone),
      weekday,
      daysAhead: offset,
      expected,
      contributions,
      band: "normal"
    });
  }

  const totals = days.map((d) => d.expected);
  const mean = totals.length === 0 ? 0 : sum(totals) / totals.length;
  const max = totals.length === 0 ? 0 : Math.max(...totals);

  for (const day of days) {
    day.band = classifyBand(day.expected, mean);
  }

  // Pick the strongest dip / spike. We use the extreme value (not the
  // first day in the band) because the user is trying to find the
  // single best/worst slot in the horizon, not "the first quiet day".
  let quietest: ForecastDay | null = null;
  let busiest: ForecastDay | null = null;
  if (days.length > 0 && totalWeight > 0) {
    quietest = days.reduce((acc, d) => (d.expected < acc.expected ? d : acc), days[0]);
    busiest = days.reduce((acc, d) => (d.expected > acc.expected ? d : acc), days[0]);
    // If every day forecasts identically (e.g. one brand, flat history)
    // there's no meaningful "best" / "worst" — collapse both to null
    // so the UI hides the callouts instead of arbitrarily picking
    // tomorrow.
    if (quietest && busiest && quietest.expected === busiest.expected) {
      quietest = null;
      busiest = null;
    }
  }

  return { horizon, days, mean, max, quietest, busiest, totalWeight };
}

type WeekdayEstimator = {
  weighted: number[];
  weight: number[];
};

function buildWeekdayEstimator(
  timeline: { date: string; count: number }[],
  todayStart: Date,
  zone: TimeZone
): WeekdayEstimator {
  const weighted = new Array(7).fill(0);
  const weight = new Array(7).fill(0);
  if (timeline.length === 0) return { weighted, weight };

  const todayMs = todayStart.getTime();
  for (const entry of timeline) {
    const dayInstant = parseDayKey(entry.date, zone);
    if (!dayInstant) continue;
    const ageDays = Math.max(
      0,
      Math.round((todayMs - dayInstant.getTime()) / 86_400_000)
    );
    // Skip future-dated entries defensively. The data layer shouldn't
    // ever produce one (the timeline ends at "today" in the platform
    // zone), but a clock-skewed test run shouldn't crash the model.
    if (ageDays < 0) continue;
    const w = Math.exp(-ageDays / FORECAST_DECAY_DAYS);
    const dow = getZonedParts(dayInstant, zone).weekday;
    weighted[dow] += entry.count * w;
    weight[dow] += w;
  }
  return { weighted, weight };
}

function readEstimate(est: WeekdayEstimator, weekday: number): number {
  const w = est.weight[weekday];
  if (w <= 0) return 0;
  return est.weighted[weekday] / w;
}

function classifyBand(expected: number, mean: number): ForecastDayBand {
  if (mean <= 0) return "normal";
  const ratio = expected / mean;
  if (ratio >= FORECAST_BUSY_RATIO) return "busy";
  if (ratio <= FORECAST_QUIET_RATIO) return "quiet";
  return "normal";
}

function sum(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
