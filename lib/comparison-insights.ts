import type { BrandPageData } from "./brand-db";
import {
  analyzeSeasonalRunup,
  SEASONAL_EVENTS
} from "./seasonal-events";

/**
 * Rule-based takeaway generation for the comparison dashboard.
 *
 * Every section of the dashboard leads with one auto-written sentence —
 * the answer to the section's question — with the chart demoted to
 * evidence. The generators here find the leader, the outlier and the
 * group norm for each dimension and phrase it; each one applies a
 * minimum-interestingness threshold and returns `null` rather than a
 * hollow sentence when the group doesn't support a real claim
 * (e.g. two near-identical senders have no "leader" worth naming).
 *
 * Pure functions over `BrandPageData[]` — no fetching, no LLM — so the
 * dashboard stays fully server-rendered and the copy is deterministic
 * for a given cohort.
 */

/* ------------------------------------------------------------------ */
/* Shared types                                                        */
/* ------------------------------------------------------------------ */

export type LeagueRow = {
  id: string;
  name: string;
  /** Index into the original `brands` array — keeps chart colors stable. */
  index: number;
  /** Average emails per week over the lookback window. */
  perWeek: number;
};

export type RhythmInsight = {
  takeaway: string | null;
  /** Sorted most-active first. */
  rows: LeagueRow[];
  groupAvgPerWeek: number;
};

export type OccasionCell = {
  /** Median days between first mention and the event; null = no signal. */
  leadDays: number | null;
  /** Run-up emails matched across occurrences. */
  count: number;
};

export type OccasionRow = {
  eventId: string;
  label: string;
  emoji: string;
  /** One cell per brand, aligned with the `brands` array order. */
  cells: OccasionCell[];
};

export type OccasionInsight = {
  takeaway: string | null;
  rows: OccasionRow[];
};

export type MixSegment = {
  id: string;
  label: string;
  share: number;
};

export type ContentMixRow = {
  id: string;
  name: string;
  index: number;
  segments: MixSegment[];
};

export type ContentMixInsight = {
  takeaway: string | null;
  rows: ContentMixRow[];
};

export type ComparisonInsights = {
  rhythm: RhythmInsight;
  timingTakeaway: string | null;
  promoTakeaway: string | null;
  occasions: OccasionInsight;
  voiceTakeaway: string | null;
  /** Group-wide subject-length range for the fingerprint sliders. */
  subjectLengthRange: { min: number; max: number } | null;
  mix: ContentMixInsight;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Lookback for the send-rate league. ~12 weeks balances "current pace"
 *  against one quiet fortnight skewing the number. */
const RATE_WINDOW_DAYS = 84;

/** Formats a rate like 3.0 → "3", 2.34 → "2.3". */
function fmt1(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Lowercases a category label for mid-sentence use ("Product launch" →
 *  "product launch"); leaves all-caps acronyms alone. */
function lower(label: string): string {
  if (label === label.toUpperCase()) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/* ------------------------------------------------------------------ */
/* Rhythm — who sends the most                                         */
/* ------------------------------------------------------------------ */

/**
 * Average emails/week over the rate window, clamped to the period the
 * brand has actually been tracked so a brand added last month isn't
 * diluted across twelve empty weeks.
 */
export function weeklySendRate(brand: BrandPageData): number {
  const timeline = brand.cadence.dailyTimeline;
  if (timeline.length === 0) return 0;

  let windowDays = Math.min(RATE_WINDOW_DAYS, timeline.length);
  const first = brand.totals.firstEmailAt;
  if (first) {
    const firstMs = new Date(first).getTime();
    if (!Number.isNaN(firstMs)) {
      const trackedDays = Math.ceil((Date.now() - firstMs) / 86_400_000);
      windowDays = Math.max(7, Math.min(windowDays, trackedDays));
    }
  }

  let count = 0;
  for (let i = timeline.length - windowDays; i < timeline.length; i++) {
    count += timeline[i]?.count ?? 0;
  }
  return count / (windowDays / 7);
}

function buildRhythm(brands: BrandPageData[]): RhythmInsight {
  const rows: LeagueRow[] = brands
    .map((b, index) => ({
      id: b.brand.id,
      name: b.brand.name,
      index,
      perWeek: weeklySendRate(b)
    }))
    .sort((a, b) => b.perWeek - a.perWeek);

  const groupAvgPerWeek = mean(rows.map((r) => r.perWeek));

  let takeaway: string | null = null;
  if (rows.length >= 2) {
    const leader = rows[0];
    const lowest = rows[rows.length - 1];
    const othersAvg = mean(rows.slice(1).map((r) => r.perWeek));

    if (leader.perWeek >= 1 && othersAvg > 0 && leader.perWeek / othersAvg >= 1.6) {
      takeaway = `${leader.name} sends about ${fmt1(leader.perWeek)} emails a week — ${fmt1(leader.perWeek / othersAvg)}× the pace of the rest of this group.`;
    } else if (
      leader.perWeek >= 1 &&
      lowest.perWeek > 0 &&
      leader.perWeek / lowest.perWeek >= 2.5
    ) {
      takeaway = `${leader.name} (${fmt1(leader.perWeek)}/week) sends ${fmt1(leader.perWeek / lowest.perWeek)}× as often as ${lowest.name} (${fmt1(lowest.perWeek)}/week).`;
    } else if (
      leader.perWeek > 0 &&
      (leader.perWeek - lowest.perWeek <= 0.5 ||
        (lowest.perWeek > 0 && leader.perWeek / lowest.perWeek <= 1.3))
    ) {
      takeaway = `The whole group sends at a similar pace — around ${fmt1(groupAvgPerWeek)} email${groupAvgPerWeek >= 1.95 ? "s" : ""} a week each.`;
    }
  }

  return { takeaway, rows, groupAvgPerWeek };
}

/* ------------------------------------------------------------------ */
/* Timing — which day the group leans on                               */
/* ------------------------------------------------------------------ */

function buildTimingTakeaway(brands: BrandPageData[]): string | null {
  if (brands.length < 2) return null;

  // Only count brands whose typical day is a meaningful habit, not a
  // 1-in-7 coin flip.
  const known = brands
    .map((b) => ({
      name: b.brand.name,
      day: b.cadence.typicalDay
    }))
    .filter(
      (entry): entry is { name: string; day: NonNullable<typeof entry.day> } =>
        entry.day !== null && entry.day.share >= 0.25
    );
  if (known.length < 2) return null;

  const byDay = new Map<string, string[]>();
  for (const entry of known) {
    const list = byDay.get(entry.day.label) ?? [];
    list.push(entry.name);
    byDay.set(entry.day.label, list);
  }

  const [topDay, topNames] = [...byDay.entries()].sort(
    (a, b) => b[1].length - a[1].length
  )[0];

  if (topNames.length === known.length) {
    return `Every brand here favours ${topDay}s — expect a crowded inbox that day.`;
  }
  if (topNames.length >= Math.ceil((known.length * 2) / 3)) {
    const outliers = known.filter((entry) => entry.day.label !== topDay);
    if (outliers.length === 1) {
      return `Most of this group sends on ${topDay}s; ${outliers[0].name} is alone on ${outliers[0].day.label}s.`;
    }
    return `Most of this group sends on ${topDay}s.`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Promo — who leans on discounts                                      */
/* ------------------------------------------------------------------ */

function buildPromoTakeaway(brands: BrandPageData[]): string | null {
  if (brands.length < 2) return null;

  const rows = brands.map((b) => ({
    name: b.brand.name,
    share: b.promo.discountShare,
    avg: b.promo.avgDiscount
  }));
  const byShare = [...rows].sort((a, b) => b.share - a.share);
  const top = byShare[0];
  const bottom = byShare[byShare.length - 1];

  if (top.share >= 0.3 && top.share - bottom.share >= 0.25) {
    const bottomClause =
      bottom.share <= 0.05
        ? `${bottom.name} almost never does`
        : `${bottom.name} stays at ${pct(bottom.share)}`;
    return `${top.name} attaches a discount to ${pct(top.share)} of their emails; ${bottomClause}.`;
  }
  if (rows.every((r) => r.share <= 0.1)) {
    return `Discounts are rare across this group — every brand keeps promo share under 10%.`;
  }

  const withDepth = rows.filter(
    (r): r is typeof r & { avg: number } => r.avg !== null
  );
  if (withDepth.length >= 2) {
    const byDepth = [...withDepth].sort((a, b) => b.avg - a.avg);
    const deep = byDepth[0];
    const shallow = byDepth[byDepth.length - 1];
    if (deep.avg - shallow.avg >= 12) {
      return `Discount depth splits the group: ${deep.name} averages ${Math.round(deep.avg)}% off, ${shallow.name} just ${Math.round(shallow.avg)}%.`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Occasions — which calendar moments they activate                    */
/* ------------------------------------------------------------------ */

/** Mentions below this stay visible but muted and never carry claims —
 *  one stray subject line is not a campaign. */
const OCCASION_SOLID_COUNT = 2;

function buildOccasions(brands: BrandPageData[]): OccasionInsight {
  const rows: OccasionRow[] = [];

  for (const event of SEASONAL_EVENTS) {
    const cells: OccasionCell[] = brands.map((b) => {
      const runup = analyzeSeasonalRunup(b.seasonalSample, event);
      return {
        leadDays: runup.typicalLeadDays,
        count: runup.matchedCount
      };
    });
    // Keep the row only when at least one brand shows a real run-up.
    if (cells.some((cell) => cell.count >= OCCASION_SOLID_COUNT)) {
      rows.push({
        eventId: event.id,
        label: event.label,
        emoji: event.emoji,
        cells
      });
    }
  }

  let takeaway: string | null = null;
  if (brands.length >= 2 && rows.length > 0) {
    // Priority 1: an event everyone runs, with one brand starting much
    // earlier than the rest.
    for (const row of rows) {
      const solid = row.cells.filter(
        (c) => c.count >= OCCASION_SOLID_COUNT && c.leadDays !== null
      );
      if (solid.length !== brands.length) continue;
      const leads = solid.map((c) => c.leadDays as number);
      const maxLead = Math.max(...leads);
      const leaderIdx = row.cells.findIndex((c) => c.leadDays === maxLead);
      const others = leads.filter((_, i) => leads.indexOf(maxLead) !== i);
      const othersMedian = median(others);
      if (maxLead - othersMedian >= 14) {
        takeaway = `Everyone runs ${row.label}; ${brands[leaderIdx].brand.name} starts about ${maxLead} days out — roughly ${maxLead - othersMedian} days before the rest.`;
        break;
      }
    }
    // Priority 2: an event only one brand activates.
    if (!takeaway && brands.length >= 3) {
      for (const row of rows) {
        const solidIdx = row.cells
          .map((c, i) => (c.count >= OCCASION_SOLID_COUNT ? i : -1))
          .filter((i) => i >= 0);
        if (solidIdx.length === 1) {
          takeaway = `Only ${brands[solidIdx[0]].brand.name} activates ${row.label} — the rest of the group sits it out.`;
          break;
        }
      }
    }
    // Priority 3: full coverage on at least one event.
    if (!takeaway) {
      const fullRow = rows.find((row) =>
        row.cells.every((c) => c.count >= OCCASION_SOLID_COUNT)
      );
      if (fullRow) {
        takeaway = `All ${brands.length} brands run ${fullRow.label} campaigns — see who starts first below.`;
      }
    }
  }

  return { takeaway, rows };
}

/* ------------------------------------------------------------------ */
/* Voice — copy habits                                                 */
/* ------------------------------------------------------------------ */

function buildVoice(brands: BrandPageData[]): {
  takeaway: string | null;
  range: { min: number; max: number } | null;
} {
  const withLength = brands.filter((b) => b.subjects.avgLength !== null);
  const lengths = withLength.map((b) => b.subjects.avgLength as number);
  const range =
    lengths.length >= 1
      ? { min: Math.min(...lengths), max: Math.max(...lengths) }
      : null;

  if (brands.length < 2) return { takeaway: null, range };

  const clauses: string[] = [];

  if (withLength.length >= 2 && range && range.max - range.min >= 15) {
    const longest = withLength.find(
      (b) => b.subjects.avgLength === range.max
    );
    const shortest = withLength.find(
      (b) => b.subjects.avgLength === range.min
    );
    if (longest && shortest) {
      clauses.push(
        `${longest.brand.name} writes the longest subject lines (≈${Math.round(range.max)} characters; ${shortest.brand.name} keeps it to ≈${Math.round(range.min)}).`
      );
    }
  }

  const byEmoji = [...brands].sort((a, b) => b.emojis.share - a.emojis.share);
  const emojiTop = byEmoji[0];
  const emojiBottom = byEmoji[byEmoji.length - 1];
  if (emojiTop.emojis.share >= 0.5 && emojiBottom.emojis.share <= 0.15) {
    clauses.push(
      `${emojiTop.brand.name} puts emoji in ${pct(emojiTop.emojis.share)} of subjects while ${emojiBottom.brand.name} stays plain.`
    );
  }

  return { takeaway: clauses.length > 0 ? clauses.join(" ") : null, range };
}

/* ------------------------------------------------------------------ */
/* Content mix — what they talk about                                  */
/* ------------------------------------------------------------------ */

/** Segments smaller than this collapse into "Other" so the bars stay
 *  readable. */
const MIX_MAX_SEGMENTS = 4;

function buildContentMix(brands: BrandPageData[]): ContentMixInsight {
  const rows: ContentMixRow[] = brands.map((b, index) => {
    const total = b.categories.reduce((sum, c) => sum + c.count, 0);
    const sorted = [...b.categories].sort((a, c) => c.count - a.count);
    const top = sorted.slice(0, MIX_MAX_SEGMENTS);
    const restCount = sorted
      .slice(MIX_MAX_SEGMENTS)
      .reduce((sum, c) => sum + c.count, 0);

    const segments: MixSegment[] =
      total > 0
        ? top.map((c) => ({
            id: c.id,
            label: c.label,
            share: c.count / total
          }))
        : [];
    if (total > 0 && restCount > 0) {
      segments.push({ id: "other", label: "Other", share: restCount / total });
    }
    return { id: b.brand.id, name: b.brand.name, index, segments };
  });

  let takeaway: string | null = null;
  if (brands.length >= 2) {
    const dominant = rows
      .map((row) => ({ row, top: row.segments[0] }))
      .filter(
        (entry): entry is { row: ContentMixRow; top: MixSegment } =>
          entry.top !== undefined && entry.top.id !== "other"
      );

    if (dominant.length >= 2) {
      const skewed = [...dominant].sort((a, b) => b.top.share - a.top.share)[0];
      const contrast = dominant.find(
        (entry) =>
          entry.row.id !== skewed.row.id &&
          (entry.top.id !== skewed.top.id ||
            (skewed.top.share - getShare(entry.row, skewed.top.id) >= 0.3))
      );

      if (skewed.top.share >= 0.6 && contrast) {
        const contrastClause =
          contrast.top.id === skewed.top.id
            ? `${contrast.row.name} keeps it to ${pct(getShare(contrast.row, skewed.top.id))}`
            : `${contrast.row.name} leads with ${lower(contrast.top.label)} (${pct(contrast.top.share)})`;
        takeaway = `${skewed.row.name} is ${pct(skewed.top.share)} ${lower(skewed.top.label)} emails; ${contrastClause}.`;
      } else if (
        dominant.length === rows.length &&
        dominant.every((entry) => entry.top.id === dominant[0].top.id)
      ) {
        takeaway = `Every brand's mix leads with ${lower(dominant[0].top.label)} emails.`;
      }
    }
  }

  return { takeaway, rows };
}

function getShare(row: ContentMixRow, categoryId: string): number {
  return row.segments.find((s) => s.id === categoryId)?.share ?? 0;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function buildComparisonInsights(
  brands: BrandPageData[]
): ComparisonInsights {
  const voice = buildVoice(brands);
  return {
    rhythm: buildRhythm(brands),
    timingTakeaway: buildTimingTakeaway(brands),
    promoTakeaway: buildPromoTakeaway(brands),
    occasions: buildOccasions(brands),
    voiceTakeaway: voice.takeaway,
    subjectLengthRange: voice.range,
    mix: buildContentMix(brands)
  };
}
