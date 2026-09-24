/**
 * Data-driven brand claims: the engine behind the public brand-page narrative.
 *
 * `buildBrandSummary` (brand-summary.ts) writes one fixed sentence shape for
 * every brand. That is fine for a teaser but it does not scale: 450 pages whose
 * prose differs only in the digits read as templated content, which is most of
 * why almost none of the brand pages are indexed today.
 *
 * The fix is to vary *what gets said*, not just the numbers. This module holds a
 * library of discrete claims, each with:
 *
 *   - a trigger  (`applies`)  — does this brand's data support the claim at all
 *   - a score    (`weight` x `surprise`) — how interesting is it *for this brand*
 *   - phrasings  (`render`)   — several interchangeable wordings
 *
 * For a given brand we evaluate every trigger, score the survivors against the
 * brand's own category, keep the most anomalous few, and compose them in
 * section order. Two brands only read alike when they genuinely behave alike.
 * Measured over the current catalogue, 446 of 455 indexable brands produce a
 * distinct combination of these traits.
 *
 * Three rules this module exists to enforce:
 *
 *  1. NO FABRICATED NUMBERS. Every figure is interpolated from {@link
 *     BrandClaimFacts}, which comes straight from the archive. There is no model
 *     in this path and nothing here invents a value.
 *
 *  2. NO OVERSTATED DISCOUNTS. `discount_percent` is the headline number an
 *     email advertised, which is almost always a ceiling ("Up to 70% Off"), not
 *     a sitewide depth. Every phrasing therefore says "up to X% off". Never
 *     render it as "discounted X%" — that is a factual error on a page carrying
 *     a real brand's name.
 *
 *  3. NO CONFIDENT CLAIMS ON THIN DATA. A brand with three captured campaigns
 *     has no cadence, no quiet day and no discount policy. Comparative and
 *     absence claims declare a `minCampaigns` floor and simply do not fire
 *     below it. See {@link claimBudget}.
 *
 * Phrasing choice is deterministic (hashed off the brand slug), so a brand's
 * wording is stable across rebuilds. Prose that churns on every regeneration is
 * its own bad signal and would defeat caching.
 */

import { EMAIL_CATEGORY_LABELS, type EmailCategory } from "./admin-types";
import { formatMarketLabel } from "./market-label";

/* -------------------------------------------------------------------------- */
/*  Facts                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Everything a claim is allowed to read. Deliberately flat and precomputed:
 * claims must be cheap, synchronous and side-effect free so the whole library
 * can be evaluated for one brand inside a render, and for all 455 in a script.
 */
export type BrandClaimFacts = {
  slug: string;
  name: string;
  /** Primary `companies.markets` tag, raw (e.g. "beauty & skincare"). */
  category: string | null;

  /** Canonical, non-welcome campaigns. One row per campaign, never per copy. */
  campaigns: number;
  /** Days between first and last captured campaign. Minimum 1. */
  spanDays: number;
  /** Distinct calendar days that saw at least one campaign. */
  sendDays: number;
  /** Campaigns per week across the tracked window. */
  perWeek: number;
  /** Distinct subject lines, used to prove these are real campaigns not copies. */
  distinctSubjects: number;

  /** Campaign mix, sorted by count descending. Welcome already excluded. */
  mix: { category: EmailCategory; count: number }[];

  /** Counts indexed 0 (Sunday) through 6 (Saturday). */
  weekdayCounts: number[];
  /** Counts indexed 0 through 23, in {@link timezoneLabel}. */
  hourCounts: number[];
  /** Human label for the timezone the hour counts are expressed in. */
  timezoneLabel: string;

  /** Campaigns naming any discount. */
  discountCount: number;
  /** Distinct discount depths seen, ascending. */
  discountDepths: number[];
  /** Deepest advertised discount. A CEILING — always render as "up to". */
  maxDiscount: number | null;
  /** ISO date of the deepest advertised discount. */
  maxDiscountAt: string | null;
  /** Campaigns carrying a promo code. */
  promoCodeCount: number;
  /** Campaigns stating an explicit offer end date. */
  deadlineCount: number;
  /** Campaigns flagged as extending a previously stated deadline. */
  extensionCount: number;

  /** Dominant ESP, lowercase provider key (e.g. "klaviyo"). */
  esp: string | null;
  /** Share (0..1) of campaigns whose preheader is padded. */
  paddedShare: number;
  /** Share (0..1) shipping a dark-mode variant. */
  darkShare: number;
  /** Share (0..1) containing an animated image. */
  gifShare: number;

  /** ISO date of the first captured campaign. */
  firstSend: string | null;
};

/**
 * The brand's category, as context for scoring. Computed across every indexable
 * brand sharing the primary market tag.
 *
 * In production this must come from a materialised view refreshed nightly, not
 * from a percentile query per render: the medians move slowly and the query
 * scans the whole category.
 */
export type CategoryBenchmark = {
  /** Raw category tag. */
  category: string;
  /** Brands in the category with enough data to benchmark against. */
  brands: number;
  medianPerWeek: number;
  p90PerWeek: number;
  /** This brand's rank by cadence, 1 = heaviest sender. Null when unrankable. */
  rankPerWeek: number | null;
  /** Median share (0..1) of campaigns carrying a discount. */
  medianDiscountShare: number;
  /** Median deepest advertised discount among brands that discount at all. */
  medianMaxDiscount: number | null;
  /** Share (0..1) of brands in the category that discount at all. */
  shareThatDiscount: number;
};

/* -------------------------------------------------------------------------- */
/*  Claim model                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Paragraph buckets. Claims are emitted in this order, and claims sharing a
 * section are joined into one paragraph.
 */
export const CLAIM_SECTIONS = [
  "cadence",
  "timing",
  "mix",
  "offers",
  "craft",
  "coverage"
] as const;

export type ClaimSection = (typeof CLAIM_SECTIONS)[number];

/** Picks one of several interchangeable phrasings, deterministically. */
type Pick = (variants: string[]) => string;

export type Claim = {
  /** Stable id. Used for the phrasing hash and for dry-run reporting, so it
   *  must never be reused for a different claim once shipped. */
  id: string;
  section: ClaimSection;
  /**
   * Claims sharing a group are mutually exclusive: only the highest-scoring one
   * is emitted. This is what stops a paragraph saying the same thing twice in
   * different words.
   */
  group: string;
  /** Minimum campaigns before this claim may fire. Guards rule 3 above. */
  minCampaigns: number;
  /** Base interest, 0..10, before the per-brand surprise multiplier. */
  weight: number;
  applies(f: BrandClaimFacts, b: CategoryBenchmark | null): boolean;
  /** Extra interest from how unusual this brand is, 0..2. Optional. */
  surprise?(f: BrandClaimFacts, b: CategoryBenchmark | null): number;
  render(f: BrandClaimFacts, b: CategoryBenchmark | null, pick: Pick): string;
};

/* -------------------------------------------------------------------------- */
/*  Formatting helpers                                                        */
/* -------------------------------------------------------------------------- */

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
] as const;

/** Lowercase campaign-type label for mid-sentence use ("product launch"). */
function typeLabel(category: EmailCategory): string {
  return (EMAIL_CATEGORY_LABELS[category] ?? String(category)).toLowerCase();
}

/**
 * "9am", "2pm", "12am". Deliberately not "midnight"/"midday": those read oddly
 * next to a timezone label ("midday UTC") and a clock time is what a marketer
 * comparing send windows actually wants.
 */
function hourLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

/** Whole percent, for shares expressed 0..1. */
function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Trims a trailing ".0" so 2.0 reads "2" but 2.4 stays "2.4". */
function num(value: number, places = 1): string {
  const fixed = value.toFixed(places);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

/** "about 13 a week", "about twice a week", "roughly once a fortnight". */
function cadencePhrase(perWeek: number): string {
  if (perWeek >= 6.5) return `about ${Math.round(perWeek)} campaigns a week`;
  if (perWeek >= 1.5) return `about ${num(perWeek)} campaigns a week`;
  if (perWeek >= 0.8) return "about once a week";
  if (perWeek >= 0.35) return "roughly every other week";
  if (perWeek >= 0.15) return "about once a month";
  return "only occasionally";
}

function monthYear(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Index of the largest value, or -1 for an empty/flat-zero array. */
function argMax(counts: number[]): number {
  let best = -1;
  let bestValue = 0;
  counts.forEach((value, index) => {
    if (value > bestValue) {
      bestValue = value;
      best = index;
    }
  });
  return best;
}

function share(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

/** Share of campaigns landing on the single busiest weekday. */
function topWeekdayShare(f: BrandClaimFacts): number {
  const index = argMax(f.weekdayCounts);
  return index < 0 ? 0 : share(f.weekdayCounts[index], f.campaigns);
}

/** Share of campaigns landing in the single busiest hour. */
function topHourShare(f: BrandClaimFacts): number {
  const index = argMax(f.hourCounts);
  return index < 0 ? 0 : share(f.hourCounts[index], f.campaigns);
}

function weekendShare(f: BrandClaimFacts): number {
  const weekend = (f.weekdayCounts[0] ?? 0) + (f.weekdayCounts[6] ?? 0);
  return share(weekend, f.campaigns);
}

function discountShare(f: BrandClaimFacts): number {
  return share(f.discountCount, f.campaigns);
}

/** Ratio of this brand's cadence to its category median. 1 when unknowable. */
function cadenceRatio(
  f: BrandClaimFacts,
  b: CategoryBenchmark | null
): number {
  if (!b || b.medianPerWeek <= 0) return 1;
  return f.perWeek / b.medianPerWeek;
}

/** Pretty category name for prose ("beauty & skincare"). */
function categoryPhrase(f: BrandClaimFacts): string {
  return f.category ? formatMarketLabel(f.category).toLowerCase() : "category";
}

/* -------------------------------------------------------------------------- */
/*  The claim library                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Roughly thirty claims across six sections. Weights are relative, not
 * absolute: what matters is the ordering they produce once multiplied by
 * surprise. A claim that fires for almost every brand (an ESP, a plain cadence)
 * carries a low weight so it only surfaces when nothing more interesting did.
 */
export const CLAIMS: Claim[] = [
  /* ---------------------------------- cadence ---------------------------- */
  {
    id: "cadence-category-leader",
    section: "cadence",
    group: "cadence-headline",
    minCampaigns: 25,
    weight: 10,
    applies: (f, b) => !!b && b.rankPerWeek === 1 && b.brands >= 8,
    surprise: (f, b) => Math.min(cadenceRatio(f, b) / 3, 2),
    render: (f, b, pick) =>
      pick([
        `${f.name} is the heaviest sender in Pirol's ${categoryPhrase(f)} category, at ${cadencePhrase(f.perWeek)} against a category median of ${num(b!.medianPerWeek)}.`,
        `No ${categoryPhrase(f)} brand in the archive sends more than ${f.name}: ${cadencePhrase(f.perWeek)}, where the category median is ${num(b!.medianPerWeek)}.`,
        `${f.name} tops the ${categoryPhrase(f)} category for volume, sending ${cadencePhrase(f.perWeek)} against a median of ${num(b!.medianPerWeek)}.`
      ])
  },
  {
    id: "cadence-top-decile",
    section: "cadence",
    group: "cadence-headline",
    minCampaigns: 25,
    weight: 8,
    applies: (f, b) =>
      !!b &&
      b.rankPerWeek !== null &&
      b.rankPerWeek > 1 &&
      b.brands >= 10 &&
      f.perWeek >= b.p90PerWeek,
    surprise: (f, b) => Math.min(cadenceRatio(f, b) / 3, 1.5),
    render: (f, b, pick) =>
      pick([
        `${f.name} sits in the top tenth of ${categoryPhrase(f)} brands for volume, sending ${cadencePhrase(f.perWeek)} where the category median is ${num(b!.medianPerWeek)}.`,
        `${f.name} sends ${cadencePhrase(f.perWeek)}, putting it in the busiest tenth of the ${categoryPhrase(f)} category.`
      ])
  },
  {
    id: "cadence-above-median",
    section: "cadence",
    group: "cadence-headline",
    minCampaigns: 20,
    weight: 6,
    applies: (f, b) => cadenceRatio(f, b) >= 1.8 && !!b && b.brands >= 8,
    surprise: (f, b) => Math.min((cadenceRatio(f, b) - 1.8) / 2, 1),
    render: (f, b, pick) =>
      pick([
        `${f.name} sends ${cadencePhrase(f.perWeek)}, roughly ${num(cadenceRatio(f, b))} times the ${categoryPhrase(f)} median.`,
        `${f.name} sends about ${num(cadenceRatio(f, b))} times as often as the typical ${categoryPhrase(f)} brand, at ${cadencePhrase(f.perWeek)}.`
      ])
  },
  {
    id: "cadence-below-median",
    section: "cadence",
    group: "cadence-headline",
    minCampaigns: 20,
    weight: 6,
    applies: (f, b) => cadenceRatio(f, b) <= 0.5 && !!b && b.brands >= 8,
    surprise: (f, b) => Math.min((0.5 - cadenceRatio(f, b)) * 2, 1),
    render: (f, b, pick) =>
      pick([
        `${f.name} is a notably quiet sender for its category, at ${cadencePhrase(f.perWeek)} against a ${categoryPhrase(f)} median of ${num(b!.medianPerWeek)}.`,
        `${f.name} sends ${cadencePhrase(f.perWeek)}, well under half the ${categoryPhrase(f)} median of ${num(b!.medianPerWeek)}.`
      ])
  },
  {
    id: "cadence-plain",
    section: "cadence",
    group: "cadence-headline",
    minCampaigns: 1,
    weight: 2,
    applies: (f) => f.perWeek > 0,
    // The fallback for every brand whose cadence is unremarkable, so it fires on
    // roughly four pages in five and its phrasings are the most-repeated text on
    // the site. Hence more variants here than anywhere else, and variants that
    // differ in *shape* rather than wording: with only two, the opening sentence
    // of 226 pages differed by a single number, which is the templating problem
    // this engine exists to avoid.
    render: (f, b, pick) =>
      pick([
        `${f.name} sends ${cadencePhrase(f.perWeek)}.`,
        `${f.name}'s list sees ${cadencePhrase(f.perWeek)}.`,
        `Across the ${f.spanDays} days tracked so far, ${f.name} sent ${f.campaigns} campaigns, ${cadencePhrase(f.perWeek)}.`,
        `${f.campaigns} campaigns over ${f.spanDays} days puts ${f.name} at ${cadencePhrase(f.perWeek)}.`,
        `${f.name} reaches its list ${cadencePhrase(f.perWeek)}.`
      ])
  },
  {
    id: "cadence-near-daily",
    section: "cadence",
    group: "cadence-density",
    minCampaigns: 20,
    weight: 7,
    applies: (f) => f.spanDays >= 14 && share(f.sendDays, f.spanDays) >= 0.85,
    surprise: (f) => (share(f.sendDays, f.spanDays) >= 0.95 ? 1 : 0.4),
    render: (f, b, pick) =>
      pick([
        `Something goes out on ${f.sendDays} of the ${f.spanDays} days tracked, so the list rarely gets a day off.`,
        `There is almost no gap in the schedule: ${f.sendDays} of ${f.spanDays} tracked days carried at least one campaign.`
      ])
  },
  {
    id: "cadence-multiple-per-day",
    section: "cadence",
    group: "cadence-density",
    minCampaigns: 25,
    weight: 8,
    applies: (f) => f.sendDays >= 10 && f.campaigns / f.sendDays >= 1.5,
    surprise: (f) => Math.min((f.campaigns / f.sendDays - 1.5) / 1.5, 1.5),
    render: (f, b, pick) =>
      pick([
        `On the days it does send, ${f.name} averages ${num(f.campaigns / f.sendDays)} campaigns rather than one.`,
        `Send days usually carry more than one campaign, averaging ${num(f.campaigns / f.sendDays)}.`
      ])
  },
  {
    id: "cadence-distinct-subjects",
    section: "cadence",
    group: "cadence-proof",
    minCampaigns: 30,
    weight: 5,
    applies: (f) => share(f.distinctSubjects, f.campaigns) >= 0.9,
    render: (f, b, pick) =>
      pick([
        `These are not segment copies of one send: ${f.distinctSubjects} of the ${f.campaigns} campaigns carried a different subject line.`,
        `Almost every campaign is genuinely distinct, with ${f.distinctSubjects} different subject lines across ${f.campaigns} sends.`
      ])
  },

  /* ---------------------------------- timing ----------------------------- */
  {
    id: "hour-single-window",
    section: "timing",
    group: "hour",
    minCampaigns: 15,
    weight: 7,
    applies: (f) => topHourShare(f) >= 0.4,
    surprise: (f) => Math.min((topHourShare(f) - 0.4) * 3, 1.5),
    render: (f, b, pick) => {
      const hour = argMax(f.hourCounts);
      return pick([
        `The timing is narrow: ${pct(topHourShare(f))} of everything lands at ${hourLabel(hour)} ${f.timezoneLabel}.`,
        `${pct(topHourShare(f))} of sends go out in a single hour, ${hourLabel(hour)} ${f.timezoneLabel}.`,
        `Almost everything ships at ${hourLabel(hour)} ${f.timezoneLabel}, which accounts for ${pct(topHourShare(f))} of the set.`
      ]);
    }
  },
  {
    id: "hour-spread",
    section: "timing",
    group: "hour",
    minCampaigns: 20,
    weight: 5,
    applies: (f) => topHourShare(f) > 0 && topHourShare(f) < 0.2,
    render: (f, b, pick) =>
      pick([
        `There is no favoured send hour: the busiest single hour accounts for only ${pct(topHourShare(f))} of campaigns.`,
        `Send times are spread across the day rather than pinned to one slot, with no hour taking more than ${pct(topHourShare(f))}.`
      ])
  },
  {
    id: "weekday-concentrated",
    section: "timing",
    group: "weekday",
    minCampaigns: 15,
    weight: 6,
    applies: (f) => topWeekdayShare(f) >= 0.3,
    surprise: (f) => Math.min((topWeekdayShare(f) - 0.3) * 4, 1.5),
    render: (f, b, pick) => {
      const day = argMax(f.weekdayCounts);
      return pick([
        `${WEEKDAYS[day]} carries ${pct(topWeekdayShare(f))} of the schedule, more than any other day.`,
        `The week is built around ${WEEKDAYS[day]}, which takes ${pct(topWeekdayShare(f))} of all sends.`
      ]);
    }
  },
  {
    id: "weekday-flat",
    section: "timing",
    group: "weekday",
    minCampaigns: 25,
    weight: 6,
    applies: (f) => topWeekdayShare(f) > 0 && topWeekdayShare(f) <= 0.18,
    render: (f, b, pick) =>
      pick([
        `Weekday choice is close to flat, with no day taking more than ${pct(topWeekdayShare(f))} and no quiet stretch anywhere in the week.`,
        `There is no quiet day: every weekday carries a comparable share, the busiest reaching only ${pct(topWeekdayShare(f))}.`
      ])
  },
  {
    id: "weekend-heavy",
    section: "timing",
    group: "weekend",
    minCampaigns: 20,
    weight: 6,
    // Two days in seven is 28.6%, so a threshold near 0.3 fires for any brand
    // that simply sends every day and says nothing about intent. The bar is a
    // clear margin above uniform instead.
    applies: (f) => weekendShare(f) >= 0.36,
    surprise: (f) => Math.min((weekendShare(f) - 0.36) * 3, 1),
    render: (f, b, pick) =>
      pick([
        `Weekends are part of the plan rather than an exception, taking ${pct(weekendShare(f))} of all campaigns.`,
        `${pct(weekendShare(f))} of sends land on a Saturday or Sunday.`
      ])
  },
  {
    id: "weekday-only",
    section: "timing",
    group: "weekend",
    minCampaigns: 20,
    weight: 6,
    applies: (f) => weekendShare(f) <= 0.04,
    render: (f, b, pick) =>
      pick([
        `The weekend is left alone: fewer than one campaign in twenty lands on a Saturday or Sunday.`,
        `Sending is a weekday habit here, with the weekend almost entirely untouched.`
      ])
  },

  /* ------------------------------------ mix ------------------------------ */
  {
    id: "mix-dominant",
    section: "mix",
    group: "mix",
    minCampaigns: 12,
    weight: 7,
    applies: (f) =>
      f.mix.length > 0 && share(f.mix[0].count, f.campaigns) >= 0.5,
    surprise: (f) =>
      Math.min((share(f.mix[0].count, f.campaigns) - 0.5) * 3, 1.5),
    render: (f, b, pick) => {
      const top = f.mix[0];
      return pick([
        `${typeLabel(top.category)} campaigns dominate the programme at ${pct(share(top.count, f.campaigns))} of everything sent.`,
        `The mix is lopsided: ${pct(share(top.count, f.campaigns))} of campaigns are ${typeLabel(top.category)}.`
      ]);
    }
  },
  {
    id: "mix-two-way",
    section: "mix",
    group: "mix",
    minCampaigns: 15,
    weight: 5,
    applies: (f) =>
      f.mix.length >= 2 &&
      share(f.mix[0].count, f.campaigns) < 0.5 &&
      share(f.mix[0].count + f.mix[1].count, f.campaigns) >= 0.6,
    render: (f, b, pick) =>
      pick([
        `The programme runs on two tracks, ${typeLabel(f.mix[0].category)} and ${typeLabel(f.mix[1].category)}, which together account for ${pct(share(f.mix[0].count + f.mix[1].count, f.campaigns))} of sends.`,
        `${typeLabel(f.mix[0].category)} and ${typeLabel(f.mix[1].category)} carry the calendar between them, at ${pct(share(f.mix[0].count + f.mix[1].count, f.campaigns))} of all campaigns.`
      ])
  },
  {
    id: "mix-balanced",
    section: "mix",
    group: "mix",
    minCampaigns: 25,
    weight: 6,
    applies: (f) =>
      f.mix.length >= 3 && share(f.mix[0].count, f.campaigns) <= 0.35,
    render: (f, b, pick) =>
      pick([
        `No single campaign type takes over: the largest, ${typeLabel(f.mix[0].category)}, is only ${pct(share(f.mix[0].count, f.campaigns))} of the mix.`,
        `The mix is unusually even, with ${typeLabel(f.mix[0].category)} leading at just ${pct(share(f.mix[0].count, f.campaigns))}.`
      ])
  },
  {
    id: "mix-launch-heavy",
    section: "mix",
    group: "mix-accent",
    minCampaigns: 20,
    weight: 6,
    applies: (f) => {
      const launch = f.mix.find((m) => m.category === "product_launch");
      return !!launch && share(launch.count, f.campaigns) >= 0.15;
    },
    render: (f, b, pick) => {
      const launch = f.mix.find((m) => m.category === "product_launch")!;
      return pick([
        `Launches are a recurring beat rather than a rare event, at ${pct(share(launch.count, f.campaigns))} of campaigns.`,
        `${pct(share(launch.count, f.campaigns))} of sends announce a launch.`
      ]);
    }
  },

  /* ----------------------------------- offers ---------------------------- */
  {
    id: "never-discounts",
    section: "offers",
    group: "discount-headline",
    minCampaigns: 20,
    weight: 10,
    applies: (f) => f.discountCount === 0,
    surprise: (f, b) => (b && b.shareThatDiscount >= 0.6 ? 1.5 : 0.8),
    render: (f, b, pick) =>
      pick([
        `${f.name} has never run a discount. Across ${f.campaigns} campaigns there is not a single price reduction, no promo code, and no deadline language anywhere in the set.`,
        `Not one of the ${f.campaigns} tracked campaigns carries a discount, a code or a countdown. ${f.name} simply does not run offers.`,
        `There is no discounting here at all: ${f.campaigns} campaigns, zero price reductions.`
      ])
  },
  {
    id: "discount-rare",
    section: "offers",
    group: "discount-headline",
    minCampaigns: 20,
    weight: 7,
    applies: (f) => f.discountCount > 0 && discountShare(f) <= 0.12,
    surprise: (f, b) =>
      b && b.medianDiscountShare >= 0.3 ? 1.2 : 0.4,
    render: (f, b, pick) =>
      pick([
        `Discounting is rare: only ${f.discountCount} of ${f.campaigns} campaigns name a price reduction.`,
        `Offers are the exception rather than the engine, appearing in ${pct(discountShare(f))} of campaigns.`
      ])
  },
  {
    id: "discount-led",
    section: "offers",
    group: "discount-headline",
    minCampaigns: 15,
    weight: 8,
    applies: (f) => discountShare(f) >= 0.4,
    surprise: (f, b) =>
      Math.min((discountShare(f) - 0.4) * 2, 1) +
      (b && discountShare(f) > b.medianDiscountShare * 1.5 ? 0.5 : 0),
    render: (f, b, pick) =>
      pick([
        `Discounting carries the programme: ${pct(discountShare(f))} of campaigns name a specific reduction.`,
        `Offers do the heavy lifting here, with ${f.discountCount} of ${f.campaigns} campaigns quoting a discount.`
      ])
  },
  {
    id: "discount-ladder",
    section: "offers",
    group: "discount-depth",
    minCampaigns: 20,
    weight: 7,
    applies: (f) => f.discountDepths.length >= 3,
    surprise: (f) => Math.min((f.discountDepths.length - 3) / 3, 1),
    render: (f, b, pick) => {
      const ladder = f.discountDepths.slice(0, -1);
      const deepest = f.discountDepths[f.discountDepths.length - 1];
      return pick([
        `The everyday ladder runs ${ladder.map((d) => `${Math.round(d)}`).join(", ")} percent, reaching up to ${Math.round(deepest)}% off at its deepest.`,
        `Offers step through ${ladder.map((d) => `${Math.round(d)}%`).join(", ")} and top out at up to ${Math.round(deepest)}% off.`
      ]);
    }
  },
  {
    id: "discount-max-only",
    section: "offers",
    group: "discount-depth",
    minCampaigns: 8,
    weight: 4,
    applies: (f) =>
      f.maxDiscount !== null && f.maxDiscount > 0 && f.discountDepths.length < 3,
    render: (f, b, pick) => {
      const month = monthYear(f.maxDiscountAt);
      return pick([
        `The deepest offer seen was up to ${Math.round(f.maxDiscount!)}% off${month ? `, in ${month}` : ""}.`,
        `Discounts reach up to ${Math.round(f.maxDiscount!)}% off at their steepest${month ? `, last seen in ${month}` : ""}.`
      ]);
    }
  },
  {
    id: "discount-deeper-than-peers",
    section: "offers",
    group: "discount-compare",
    minCampaigns: 25,
    weight: 7,
    applies: (f, b) =>
      !!b &&
      b.medianMaxDiscount !== null &&
      f.maxDiscount !== null &&
      f.maxDiscount >= b.medianMaxDiscount * 1.4 &&
      b.brands >= 10,
    render: (f, b, pick) =>
      pick([
        `That is noticeably deeper than the category norm, where the typical ${categoryPhrase(f)} brand tops out around ${Math.round(b!.medianMaxDiscount!)}%.`,
        `For context, the median ${categoryPhrase(f)} brand's deepest offer is about ${Math.round(b!.medianMaxDiscount!)}%.`
      ])
  },
  {
    id: "discount-automatic",
    section: "offers",
    group: "discount-mechanics",
    minCampaigns: 15,
    weight: 6,
    applies: (f) =>
      f.discountCount >= 5 && share(f.promoCodeCount, f.campaigns) <= 0.1,
    render: (f, b, pick) =>
      pick([
        `Almost none of it is gated: ${f.promoCodeCount === 0 ? "no campaign carries" : `only ${f.promoCodeCount} campaigns carry`} a promo code, so the offer applies automatically.`,
        `The discount is applied for you rather than typed in, with codes appearing in only ${pct(share(f.promoCodeCount, f.campaigns))} of campaigns.`
      ])
  },
  {
    id: "discount-code-gated",
    section: "offers",
    group: "discount-mechanics",
    minCampaigns: 15,
    weight: 6,
    applies: (f) =>
      f.discountCount >= 5 && share(f.promoCodeCount, f.campaigns) >= 0.4,
    render: (f, b, pick) =>
      pick([
        `Offers are code-gated: ${pct(share(f.promoCodeCount, f.campaigns))} of campaigns require a promo code at checkout.`,
        `Most reductions come with a code attached, in ${pct(share(f.promoCodeCount, f.campaigns))} of campaigns.`
      ])
  },
  {
    id: "deadline-led",
    section: "offers",
    group: "deadlines",
    minCampaigns: 20,
    weight: 6,
    applies: (f) => share(f.deadlineCount, f.campaigns) >= 0.35,
    surprise: (f) => Math.min((share(f.deadlineCount, f.campaigns) - 0.35) * 2, 1),
    render: (f, b, pick) =>
      pick([
        `Deadlines are stated openly, in ${pct(share(f.deadlineCount, f.campaigns))} of campaigns.`,
        `Urgency is explicit rather than implied: ${f.deadlineCount} campaigns name the date the offer ends.`
      ])
  },
  {
    id: "deadlines-never-extended",
    section: "offers",
    group: "deadline-integrity",
    minCampaigns: 25,
    weight: 7,
    applies: (f) => f.deadlineCount >= 8 && f.extensionCount === 0,
    render: (f, b, pick) =>
      pick([
        `Across this window not one of those deadlines was extended.`,
        `Every stated deadline held: there are no extensions anywhere in the set.`
      ])
  },
  {
    id: "deadlines-extended",
    section: "offers",
    group: "deadline-integrity",
    minCampaigns: 20,
    weight: 8,
    applies: (f) => f.extensionCount > 0,
    surprise: (f) => Math.min(f.extensionCount / 4, 1.5),
    render: (f, b, pick) =>
      pick([
        `Stated deadlines do move, though: ${f.extensionCount} ${f.extensionCount === 1 ? "campaign extends" : "campaigns extend"} an offer that had already been given an end date.`,
        f.extensionCount === 1
          ? `One of those deadlines was later pushed back, which tells you how firm the countdown really is.`
          : `${f.extensionCount} of those deadlines were later pushed back, which tells you how firm the countdown really is.`
      ])
  },
  {
    id: "discounts-without-deadlines",
    section: "offers",
    group: "deadlines",
    minCampaigns: 25,
    weight: 7,
    applies: (f) => f.discountCount >= 8 && f.deadlineCount === 0,
    render: (f, b, pick) =>
      pick([
        `None of the offers carry a stated end date, so the urgency is left implicit.`,
        `Discounts run without a published deadline anywhere in the set.`
      ])
  },

  /* ----------------------------------- craft ----------------------------- */
  {
    id: "esp",
    section: "craft",
    group: "esp",
    minCampaigns: 8,
    weight: 3,
    applies: (f) => !!f.esp,
    render: (f, b, pick) =>
      pick([
        `${f.name} sends through ${formatMarketLabel(f.esp!)}.`,
        `The programme runs on ${formatMarketLabel(f.esp!)}.`
      ])
  },
  {
    id: "pads-every-preheader",
    section: "craft",
    group: "preheader",
    minCampaigns: 15,
    weight: 5,
    applies: (f) => f.paddedShare >= 0.95,
    render: (f, b, pick) =>
      pick([
        `Every campaign pads its preheader, the whitespace trick that stops inbox previews spilling body copy into the subject line.`,
        `Preheader padding is applied on every send without exception.`
      ])
  },
  {
    id: "pads-no-preheader",
    section: "craft",
    group: "preheader",
    minCampaigns: 20,
    weight: 6,
    applies: (f) => f.paddedShare <= 0.05,
    render: (f, b, pick) =>
      pick([
        `No campaign pads its preheader, so inbox previews pull whatever body copy comes first.`,
        `Preheader padding is not used at all, which leaves the inbox preview to chance.`
      ])
  },
  {
    id: "no-dark-mode",
    section: "craft",
    group: "dark-mode",
    minCampaigns: 20,
    weight: 6,
    applies: (f) => f.darkShare === 0,
    render: (f, b, pick) =>
      pick([
        `None of the ${f.campaigns} campaigns ship a dark-mode variant.`,
        `Dark mode is unhandled across the whole set.`
      ])
  },
  {
    id: "dark-mode-ready",
    section: "craft",
    group: "dark-mode",
    minCampaigns: 15,
    weight: 7,
    applies: (f) => f.darkShare >= 0.5,
    surprise: () => 1,
    render: (f, b, pick) =>
      pick([
        `Unusually, ${pct(f.darkShare)} of campaigns ship a dark-mode variant.`,
        `Dark mode is handled deliberately here, in ${pct(f.darkShare)} of sends.`
      ])
  },
  {
    id: "gif-heavy",
    section: "craft",
    group: "animation",
    minCampaigns: 15,
    weight: 5,
    applies: (f) => f.gifShare >= 0.35,
    render: (f, b, pick) =>
      pick([
        `Animation is a house style rather than an occasional flourish, appearing in ${pct(f.gifShare)} of campaigns.`,
        `${pct(f.gifShare)} of sends contain an animated image.`
      ])
  },

  /* --------------------------------- coverage ---------------------------- */
  {
    id: "coverage-window",
    section: "coverage",
    group: "coverage",
    minCampaigns: 1,
    weight: 1,
    applies: (f) => !!f.firstSend && f.campaigns > 0,
    render: (f, b, pick) =>
      pick([
        `Pirol has tracked ${f.campaigns} ${f.campaigns === 1 ? "campaign" : "campaigns"} from ${f.name} since ${monthYear(f.firstSend)}.`,
        `This reads ${f.campaigns} tracked ${f.campaigns === 1 ? "campaign" : "campaigns"}, captured since ${monthYear(f.firstSend)}.`
      ])
  }
];

/* -------------------------------------------------------------------------- */
/*  Selection                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * FNV-1a. Small, dependency-free and stable across Node versions, which matters
 * because it decides a brand's wording: the same slug must always pick the same
 * phrasing so the page does not rewrite itself on every rebuild.
 */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Minimum campaigns before a brand gets a generated narrative at all.
 *
 * Set from measurement, not taste. Across the current catalogue the 177 brands
 * below 15 campaigns produce only 8 distinct claim sets between them (88 of
 * them share one), because almost nothing but cadence, ESP and the tracking
 * window can fire on that little data. A narrative there is boilerplate by
 * construction, which is the exact failure this engine exists to avoid. Below
 * this floor the caller should fall back to the single-sentence
 * `buildBrandSummary`, which is honest about saying very little.
 *
 * Note this is a *campaign* count (canonical, welcome excluded) and is
 * therefore stricter than `MIN_INDEXABLE_EMAILS`, which counts raw emails.
 */
export const NARRATIVE_MIN_CAMPAIGNS = 15;

/**
 * How many claims a brand's data can carry. The floors are deliberately
 * conservative: signature diversity among very thin brands is mostly
 * small-sample noise, and a confident paragraph built on seven emails is worse
 * than a short one.
 */
export function claimBudget(campaigns: number): number {
  if (campaigns < 15) return 3;
  if (campaigns < 40) return 6;
  return 9;
}

/**
 * Within a paragraph, claims read in library order rather than score order.
 * Scoring decides *whether* a claim earns a slot; it makes for bad prose when it
 * also decides sequence, because it lets "one of those deadlines was extended"
 * land before "deadlines are stated openly" and the paragraph argues backwards.
 */
const LIBRARY_ORDER = new Map(CLAIMS.map((claim, index) => [claim.id, index]));

/**
 * The group that must always survive selection. Every narrative has to open on
 * cadence: it carries the brand name (the keyword the page is competing for) and
 * it is the question people are actually searching. Without the pin, a brand
 * with many strong mid-weight claims could spend its whole budget elsewhere and
 * open on a subject-line statistic.
 */
const PINNED_GROUP = "cadence-headline";

export type SelectedClaim = {
  claim: Claim;
  score: number;
  text: string;
};

/**
 * Evaluates the whole library against one brand and returns the claims worth
 * printing, highest score first.
 *
 * Groups are resolved before the budget is applied, so a brand never spends two
 * of its slots on the same observation.
 */
export function selectClaims(
  facts: BrandClaimFacts,
  benchmark: CategoryBenchmark | null
): SelectedClaim[] {
  const budget = claimBudget(facts.campaigns);

  const scored = CLAIMS.filter((claim) => {
    if (facts.campaigns < claim.minCampaigns) return false;
    try {
      return claim.applies(facts, benchmark);
    } catch {
      // A claim must never take a page down. Treat a throwing trigger as a
      // non-match and let the dry run surface it.
      return false;
    }
  }).map((claim) => {
    const surprise = claim.surprise
      ? Math.max(0, Math.min(claim.surprise(facts, benchmark), 2))
      : 0;
    return { claim, score: claim.weight * (1 + surprise) };
  });

  // Highest score wins its group; ties break on claim id so the result is
  // deterministic rather than dependent on library ordering.
  const byGroup = new Map<string, { claim: Claim; score: number }>();
  for (const entry of scored) {
    const held = byGroup.get(entry.claim.group);
    if (
      !held ||
      entry.score > held.score ||
      (entry.score === held.score && entry.claim.id < held.claim.id)
    ) {
      byGroup.set(entry.claim.group, entry);
    }
  }

  // Rank by score, then reserve the pinned group's slot before the budget is
  // spent so it can never be crowded out by higher-scoring detail.
  const ranked = [...byGroup.values()].sort(
    (a, b) => b.score - a.score || a.claim.id.localeCompare(b.claim.id)
  );
  const pinned = ranked.find((entry) => entry.claim.group === PINNED_GROUP);
  const rest = ranked.filter((entry) => entry !== pinned);
  const kept = pinned
    ? [pinned, ...rest.slice(0, Math.max(budget - 1, 0))]
    : rest.slice(0, budget);

  return kept
    .sort(
      (a, b) =>
        (LIBRARY_ORDER.get(a.claim.id) ?? 0) -
        (LIBRARY_ORDER.get(b.claim.id) ?? 0)
    )
    .map(({ claim, score }) => {
      const pick: Pick = (variants) =>
        variants[hash(`${facts.slug}:${claim.id}`) % variants.length];
      return { claim, score, text: claim.render(facts, benchmark, pick) };
    });
}

export type BrandNarrative = {
  /** One string per non-empty section, in {@link CLAIM_SECTIONS} order. */
  paragraphs: string[];
  /** Ids of the claims that fired, for debugging and dry-run reporting. */
  claimIds: string[];
  /** Total words across all paragraphs. */
  wordCount: number;
};

/**
 * Composes the selected claims into paragraphs.
 *
 * Score decides which claims earn a slot; the printed sequence is section order
 * then library order, so the narrative always opens on cadence (where the brand
 * name and the query intent live) and closes on the tracking window.
 *
 * Returns null when the brand has too little data to say anything distinctive
 * ({@link NARRATIVE_MIN_CAMPAIGNS}). Callers must fall back to
 * `buildBrandSummary` rather than rendering an empty section.
 */
export function buildBrandNarrative(
  facts: BrandClaimFacts,
  benchmark: CategoryBenchmark | null
): BrandNarrative | null {
  if (facts.campaigns < NARRATIVE_MIN_CAMPAIGNS) return null;

  const selected = selectClaims(facts, benchmark);
  if (selected.length === 0) return null;

  const paragraphs: string[] = [];
  for (const section of CLAIM_SECTIONS) {
    const inSection = selected.filter((s) => s.claim.section === section);
    if (inSection.length === 0) continue;
    paragraphs.push(inSection.map((s) => s.text).join(" "));
  }

  const wordCount = paragraphs
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;

  return {
    paragraphs,
    claimIds: selected.map((s) => s.claim.id),
    wordCount
  };
}
