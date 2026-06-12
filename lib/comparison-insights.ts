import type { BrandPageData } from "./brand-db";
import { getZonedParts } from "./datetime";
import {
  analyzeSeasonalRunup,
  buildEventMatcher,
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
  /**
   * Same rate over the 12 weeks *before* the lookback window, or null
   * when the brand wasn't tracked long enough for a fair comparison.
   * Powers the league table's trend indicator.
   */
  prevPerWeek: number | null;
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

export type QuietZoneSlot = {
  dayIndex: number;
  daypartIndex: number;
  /** "Friday evening" — ready to render. */
  label: string;
  count: number;
  /**
   * Which brands send in this slot, busiest first — powers the hover
   * "who's here" breakdown. `index` aligns with the `brands` array so
   * the UI can recover each brand's colour. Empty for an open slot.
   */
  senders: { index: number; name: string; count: number }[];
};

export type QuietZonesInsight = {
  takeaway: string | null;
  /**
   * grid[daypartIndex][weekdayIndex] = sends across the whole group,
   * weekdays Monday-first. Dayparts per {@link QUIET_ZONE_DAYPARTS};
   * night (23–06) is excluded — an empty night is trivia, not an
   * opportunity.
   */
  grid: number[][];
  /** Full slot detail per cell: cells[daypartIndex][dayIndex], carrying
   *  the per-brand senders so a grid cell can show who's there on hover. */
  cells: QuietZoneSlot[][];
  totalSends: number;
  /**
   * The most open send windows, quietest first — the actionable "slot
   * your campaign here" shortlist. Weekday + earlier-daypart slots win
   * ties, so an empty Tuesday morning ranks above an empty Saturday
   * evening. Empty until the sample clears the volume threshold.
   */
  openings: QuietZoneSlot[];
  /** The single busiest window — the one to avoid (or to validate a
   *  time everyone already trusts). Null below the volume threshold. */
  busiest: QuietZoneSlot | null;
};

export type DiscountTrendInsight = {
  /** Month keys (YYYY-MM), ascending — the shared x-axis. */
  months: string[];
  /**
   * One row per brand (aligned with the `brands` array): average
   * discount per month, or null for months without discount emails.
   */
  rows: { index: number; name: string; points: (number | null)[] }[];
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
  quietZones: QuietZonesInsight;
  /** Per-brand share of subjects using urgency language (brands order). */
  urgencyShares: number[];
  /** Per-brand share of campaigns that get a follow-up send (brands order). */
  reminderShares: number[];
  discountTrend: DiscountTrendInsight;
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

/** Minimum days of history a trend baseline needs — a one-week-old
 *  "previous period" is noise dressed up as a trend. */
const PREV_RATE_MIN_DAYS = 28;

/**
 * The brand's send rate over the 12 weeks preceding the current rate
 * window, or null when the timeline / tracking period can't cover at
 * least {@link PREV_RATE_MIN_DAYS} of it.
 */
export function previousWeeklySendRate(brand: BrandPageData): number | null {
  const timeline = brand.cadence.dailyTimeline;
  const end = timeline.length - RATE_WINDOW_DAYS;
  if (end < PREV_RATE_MIN_DAYS) return null;

  let windowDays = Math.min(RATE_WINDOW_DAYS, end);
  const first = brand.totals.firstEmailAt;
  if (first) {
    const firstMs = new Date(first).getTime();
    if (!Number.isNaN(firstMs)) {
      const trackedDays =
        Math.ceil((Date.now() - firstMs) / 86_400_000) - RATE_WINDOW_DAYS;
      if (trackedDays < PREV_RATE_MIN_DAYS) return null;
      windowDays = Math.min(windowDays, trackedDays);
    }
  }

  let count = 0;
  for (let i = end - windowDays; i < end; i++) {
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
      perWeek: weeklySendRate(b),
      prevPerWeek: previousWeeklySendRate(b)
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

function buildVoice(
  brands: BrandPageData[],
  urgencyShares: number[]
): {
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

  // Candidate clauses in priority order; at most two make the sentence
  // so the takeaway stays a takeaway and not a paragraph.
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

  const byUrgency = brands
    .map((b, i) => ({ name: b.brand.name, share: urgencyShares[i] ?? 0 }))
    .sort((a, b) => b.share - a.share);
  const urgencyTop = byUrgency[0];
  const urgencyBottom = byUrgency[byUrgency.length - 1];
  if (urgencyTop.share >= 0.2 && urgencyBottom.share <= 0.05) {
    clauses.push(
      `${urgencyTop.name} pushes urgency ("last chance", "ends tonight") in ${pct(urgencyTop.share)} of subjects; ${urgencyBottom.name} ${urgencyBottom.share === 0 ? "never does" : "almost never does"}.`
    );
  }

  const byEmoji = [...brands].sort((a, b) => b.emojis.share - a.emojis.share);
  const emojiTop = byEmoji[0];
  const emojiBottom = byEmoji[byEmoji.length - 1];
  if (emojiTop.emojis.share >= 0.5 && emojiBottom.emojis.share <= 0.15) {
    clauses.push(
      `${emojiTop.brand.name} puts emoji in ${pct(emojiTop.emojis.share)} of subjects while ${emojiBottom.brand.name} stays plain.`
    );
  }

  const picked = clauses.slice(0, 2);
  return { takeaway: picked.length > 0 ? picked.join(" ") : null, range };
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
/* Quiet zones — where nobody in the group sends                       */
/* ------------------------------------------------------------------ */

export const QUIET_ZONE_DAYPARTS = [
  { id: "morning", label: "Morning", fromHour: 6, toHour: 12 },
  { id: "afternoon", label: "Afternoon", fromHour: 12, toHour: 17 },
  { id: "evening", label: "Evening", fromHour: 17, toHour: 23 }
] as const;

export const QUIET_ZONE_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
] as const;

/** Below this many total sends an empty cell is sampling noise, not a
 *  finding — the takeaway stays silent. */
const QUIET_ZONE_MIN_SENDS = 40;

function buildQuietZones(brands: BrandPageData[]): QuietZonesInsight {
  const grid: number[][] = QUIET_ZONE_DAYPARTS.map(() =>
    new Array(QUIET_ZONE_DAYS.length).fill(0)
  );
  // Per-slot brand tallies: byBrand[daypart][day] = Map(brandIndex → count).
  const byBrand: Map<number, number>[][] = QUIET_ZONE_DAYPARTS.map(() =>
    Array.from({ length: QUIET_ZONE_DAYS.length }, () => new Map<number, number>())
  );
  let totalSends = 0;

  brands.forEach((brand, brandIndex) => {
    for (const email of brand.seasonalSample) {
      let parts;
      try {
        parts = getZonedParts(email.receivedAt);
      } catch {
        continue;
      }
      // 0 = Sunday in ZonedParts; shift to Monday-first columns.
      const dayIdx = (parts.weekday + 6) % 7;
      const daypartIdx = QUIET_ZONE_DAYPARTS.findIndex(
        (dp) => parts.hour >= dp.fromHour && parts.hour < dp.toHour
      );
      if (daypartIdx === -1) continue;
      grid[daypartIdx][dayIdx] += 1;
      const cell = byBrand[daypartIdx][dayIdx];
      cell.set(brandIndex, (cell.get(brandIndex) ?? 0) + 1);
      totalSends += 1;
    }
  });

  const enough = brands.length >= 2 && totalSends >= QUIET_ZONE_MIN_SENDS;

  // Desirability of an open slot: weekday beats weekend (an untouched
  // Tuesday is the bigger opportunity than a quiet Saturday), and an
  // earlier daypart beats a later one. Shared by the takeaway and the
  // ranked openings so they never disagree.
  const slotScore = (dayIdx: number, daypartIdx: number) =>
    (dayIdx < 5 ? 2 : 0) + (daypartIdx < 2 ? 1 : 0);

  const cells: QuietZoneSlot[][] = grid.map((row, dp) =>
    row.map((count, day) => ({
      dayIndex: day,
      daypartIndex: dp,
      label: `${QUIET_ZONE_DAYS[day]} ${QUIET_ZONE_DAYPARTS[dp].label.toLowerCase()}`,
      count,
      senders: [...byBrand[dp][day].entries()]
        .map(([index, n]) => ({
          index,
          name: brands[index]?.brand.name ?? "",
          count: n
        }))
        .sort((a, b) => b.count - a.count)
    }))
  );
  const slots: QuietZoneSlot[] = cells.flat();

  // Openings: quietest first, ties broken by desirability.
  const openings = enough
    ? [...slots]
        .sort(
          (a, b) =>
            a.count - b.count ||
            slotScore(b.dayIndex, b.daypartIndex) -
              slotScore(a.dayIndex, a.daypartIndex)
        )
        .slice(0, 3)
    : [];

  const busiest = enough
    ? slots.reduce((a, b) => (b.count > a.count ? b : a))
    : null;

  let takeaway: string | null = null;
  if (enough) {
    const dayScanOrder = [0, 1, 2, 3, 4, 5, 6];
    const emptyDay = dayScanOrder.find((dayIdx) =>
      grid.every((row) => row[dayIdx] === 0)
    );
    if (emptyDay !== undefined) {
      takeaway = `Nobody in this group sends on ${QUIET_ZONE_DAYS[emptyDay]}s — the inbox is wide open all day.`;
    } else {
      const topOpening = openings[0];
      if (topOpening && topOpening.count === 0) {
        takeaway = `No one here competes for ${topOpening.label} attention — an open slot.`;
      } else {
        takeaway = `Every slot is contested — this group covers the whole week, morning to evening.`;
      }
    }
  }

  return { takeaway, grid, cells, totalSends, openings, busiest };
}

/* ------------------------------------------------------------------ */
/* Urgency — scarcity language in subjects                             */
/* ------------------------------------------------------------------ */

/**
 * Curated, deliberately conservative phrase list (English + Danish,
 * matching the platform's market — same convention as the seasonal
 * event keywords). A false "urgent" reading is a wrong number on a
 * stats page; a missed paraphrase is invisible.
 */
const URGENCY_PHRASES = [
  "last chance",
  "last day",
  "last days",
  "last call",
  "final hours",
  "final call",
  "final sale hours",
  "ends tonight",
  "ends today",
  "ends tomorrow",
  "ends sunday",
  "ends midnight",
  "ends soon",
  "hurry",
  "don't miss",
  "dont miss",
  "today only",
  "tonight only",
  "selling fast",
  "almost gone",
  "while stocks last",
  "while supplies last",
  "sidste chance",
  "sidste dag",
  "slutter i dag",
  "slutter i aften",
  "slutter ved midnat",
  "kun i dag",
  "kun i aften",
  "skynd dig",
  "gå ikke glip",
  "udløber"
];

const matchesUrgency = buildEventMatcher(URGENCY_PHRASES);

/** Share of a brand's sampled emails using urgency language in the
 *  subject or preheader. */
export function urgencyShare(brand: BrandPageData): number {
  const sample = brand.seasonalSample;
  if (sample.length === 0) return 0;
  let matched = 0;
  for (const email of sample) {
    if (matchesUrgency(`${email.subject ?? ""} ${email.preheader ?? ""}`)) {
      matched += 1;
    }
  }
  return matched / sample.length;
}

/* ------------------------------------------------------------------ */
/* Reminders — does a campaign get a follow-up send?                   */
/* ------------------------------------------------------------------ */

/** Two sends this many days apart (or closer) with near-identical
 *  subjects count as one campaign thread. */
const REMINDER_WINDOW_DAYS = 5;
const REMINDER_SIMILARITY = 0.6;
/** Below this many detected campaigns the share is too noisy to claim. */
const REMINDER_MIN_THREADS = 8;

function subjectTokens(subject: string): Set<string> {
  const tokens = subject
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((token) => token.length >= 3);
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

/**
 * Detects campaign threads via subject similarity: a send whose
 * subject heavily overlaps a send from the previous few days is a
 * reminder/resend of that campaign ("Last chance: 30% off" following
 * "30% off everything"). Returns the share of threads that received at
 * least one follow-up. Transactional and welcome emails are excluded —
 * receipts legitimately repeat phrasing without being campaigns.
 */
export function reminderShare(brand: BrandPageData): {
  share: number;
  threads: number;
} {
  const emails = brand.seasonalSample
    .filter(
      (email) =>
        email.category !== "transactional" && email.category !== "welcome"
    )
    .map((email) => ({
      tokens: subjectTokens(email.subject ?? ""),
      at: new Date(email.receivedAt).getTime()
    }))
    .filter((email) => !Number.isNaN(email.at) && email.tokens.size > 0)
    .sort((a, b) => a.at - b.at);

  type Thread = { tokens: Set<string>; lastAt: number; size: number };
  const threads: Thread[] = [];
  const windowMs = REMINDER_WINDOW_DAYS * 86_400_000;

  for (const email of emails) {
    let attached = false;
    // Scan newest-first so a reminder chains onto the most recent
    // matching thread rather than an older campaign reusing words.
    for (let i = threads.length - 1; i >= 0; i--) {
      const thread = threads[i];
      if (email.at - thread.lastAt > windowMs) break;
      if (jaccard(email.tokens, thread.tokens) >= REMINDER_SIMILARITY) {
        thread.lastAt = email.at;
        thread.size += 1;
        attached = true;
        break;
      }
    }
    if (!attached) {
      threads.push({ tokens: email.tokens, lastAt: email.at, size: 1 });
    }
  }

  if (threads.length === 0) return { share: 0, threads: 0 };
  const withFollowUp = threads.filter((t) => t.size >= 2).length;
  return { share: withFollowUp / threads.length, threads: threads.length };
}

/* ------------------------------------------------------------------ */
/* Discount trend — how depth moves month to month                     */
/* ------------------------------------------------------------------ */

/**
 * How many months the discount-depth strip spans. Data-driven and
 * rolling: the axis is the most recent N months that actually appear
 * in the sample, so it fills in on its own as tracking accumulates and
 * then slides forward. 12 captures a full seasonal cycle (summer
 * sales, Black Friday, January clearance) once the data reaches back
 * that far; younger brands just show however many months exist.
 */
const TREND_MONTHS = 12;

function monthKey(receivedAt: string): string | null {
  try {
    const parts = getZonedParts(receivedAt);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
  } catch {
    return null;
  }
}

function buildDiscountTrend(brands: BrandPageData[]): DiscountTrendInsight {
  // Shared axis: the most recent TREND_MONTHS month keys seen across
  // the whole group, so every brand's bars align.
  const allMonths = new Set<string>();
  for (const brand of brands) {
    for (const email of brand.seasonalSample) {
      const key = monthKey(email.receivedAt);
      if (key) allMonths.add(key);
    }
  }
  const months = [...allMonths].sort().slice(-TREND_MONTHS);
  const monthIndex = new Map(months.map((key, i) => [key, i]));

  const rows = brands.map((brand, index) => {
    const sums = new Array<number>(months.length).fill(0);
    const counts = new Array<number>(months.length).fill(0);
    for (const email of brand.seasonalSample) {
      if (email.discountPercent === null || email.discountPercent <= 0) {
        continue;
      }
      const key = monthKey(email.receivedAt);
      const idx = key !== null ? monthIndex.get(key) : undefined;
      if (idx === undefined) continue;
      sums[idx] += email.discountPercent;
      counts[idx] += 1;
    }
    return {
      index,
      name: brand.brand.name,
      points: months.map((_, i) =>
        counts[i] > 0 ? sums[i] / counts[i] : null
      )
    };
  });

  return { months, rows };
}

/**
 * Group-level "discount creep" claim: compares the early months of the
 * trend window against the recent ones, weighted by email counts.
 * Returns null without enough volume or movement.
 */
function discountCreepTakeaway(
  brands: BrandPageData[],
  trend: DiscountTrendInsight
): string | null {
  if (brands.length < 2 || trend.months.length < 4) return null;

  const monthIndexOf = new Map(trend.months.map((key, i) => [key, i]));
  const sums = new Array<number>(trend.months.length).fill(0);
  const counts = new Array<number>(trend.months.length).fill(0);
  for (const brand of brands) {
    for (const email of brand.seasonalSample) {
      if (email.discountPercent === null || email.discountPercent <= 0) {
        continue;
      }
      const key = monthKey(email.receivedAt);
      const idx = key !== null ? monthIndexOf.get(key) : undefined;
      if (idx === undefined) continue;
      sums[idx] += email.discountPercent;
      counts[idx] += 1;
    }
  }

  const half = Math.floor(trend.months.length / 2);
  const earlyCount = counts.slice(0, half).reduce((a, b) => a + b, 0);
  const lateCount = counts.slice(half).reduce((a, b) => a + b, 0);
  if (earlyCount < 5 || lateCount < 5) return null;

  const earlyAvg =
    sums.slice(0, half).reduce((a, b) => a + b, 0) / earlyCount;
  const lateAvg = sums.slice(half).reduce((a, b) => a + b, 0) / lateCount;
  const delta = lateAvg - earlyAvg;
  if (Math.abs(delta) < 5) return null;

  const spanMonths = trend.months.length;
  return `The group's typical discount ${delta > 0 ? "climbed" : "fell"} from ~${Math.round(earlyAvg)}% to ~${Math.round(lateAvg)}% over the last ${spanMonths} months.`;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Reminder-behaviour contrast, appended to the rhythm takeaway: only
 * speaks when both extremes have enough detected campaigns to trust
 * the share.
 */
function buildReminderClause(
  brands: BrandPageData[],
  stats: { share: number; threads: number }[]
): string | null {
  if (brands.length < 2) return null;
  const eligible = brands
    .map((b, i) => ({
      name: b.brand.name,
      share: stats[i]?.share ?? 0,
      threads: stats[i]?.threads ?? 0
    }))
    .filter((entry) => entry.threads >= REMINDER_MIN_THREADS);
  if (eligible.length < 2) return null;

  const sorted = [...eligible].sort((a, b) => b.share - a.share);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  if (top.share >= 0.4 && bottom.share <= 0.1) {
    return `${top.name} follows up on ${pct(top.share)} of campaigns with a reminder send; ${bottom.name} is one-and-done.`;
  }
  return null;
}

export function buildComparisonInsights(
  brands: BrandPageData[]
): ComparisonInsights {
  const urgencyShares = brands.map((b) => urgencyShare(b));
  const reminderStats = brands.map((b) => reminderShare(b));
  const voice = buildVoice(brands, urgencyShares);

  const rhythm = buildRhythm(brands);
  const reminderClause = buildReminderClause(brands, reminderStats);
  const rhythmTakeaway =
    [rhythm.takeaway, reminderClause].filter(Boolean).join(" ") || null;

  const discountTrend = buildDiscountTrend(brands);
  // A time-based movement claim beats the static contrast when both
  // are available — change is what marketers act on.
  const promoTakeaway =
    discountCreepTakeaway(brands, discountTrend) ??
    buildPromoTakeaway(brands);

  return {
    rhythm: { ...rhythm, takeaway: rhythmTakeaway },
    timingTakeaway: buildTimingTakeaway(brands),
    promoTakeaway,
    occasions: buildOccasions(brands),
    voiceTakeaway: voice.takeaway,
    subjectLengthRange: voice.range,
    mix: buildContentMix(brands),
    quietZones: buildQuietZones(brands),
    urgencyShares,
    reminderShares: reminderStats.map((s) => s.share),
    discountTrend
  };
}
