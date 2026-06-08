/**
 * Seasonal-event run-up analysis.
 *
 * Many newsletter programs ramp up around a fixed point in the calendar
 * — Father's Day, Black Friday, Christmas — starting weeks ahead and
 * getting louder as the day nears. This module answers two questions for
 * a single brand and a single event:
 *
 *   1. How far in advance do they start mentioning it? ("lead time")
 *   2. How many emails do they send in the run-up?
 *
 * Detection is keyword-based against the subject line + preheader (the
 * only reliable, body-free signal we ship to the dashboard), so each
 * event carries a curated keyword set. Because the platform standardises
 * on the Danish market (Europe/Copenhagen) the keyword lists are
 * bilingual — English *and* Danish — and the event dates use the Danish
 * convention where it differs (Father's Day = June 5 / Grundlovsdag,
 * Christmas anchored on December 24).
 *
 * Everything here is pure and isomorphic so the brand dashboard can run
 * the analysis client-side and re-compute instantly as the user flips
 * between events, and so it's unit-testable without a DOM.
 */

import {
  differenceInCalendarDays,
  formatDayKey,
  getZonedParts,
  parseDayKey,
  type TimeZone
} from "./datetime";

/** A concrete calendar date (1-12 month, 1-31 day) for a given year. */
export type SeasonalEventDate = { month: number; day: number };

export type SeasonalEvent = {
  /** Stable id, used as the React key and the selected-event token. */
  id: string;
  /** Display name, e.g. "Father's Day". */
  label: string;
  /** A single glyph used as the timeline's "flag" at the event day. */
  emoji: string;
  /**
   * Case-insensitive phrases that mark an email as being *about* this
   * event. Matched on word boundaries (Unicode-aware) against the
   * subject + preheader, so "jul" hits Danish Christmas but not "July".
   */
  keywords: string[];
  /** Resolves the event's calendar date for a specific year. */
  dateForYear: (year: number) => SeasonalEventDate;
};

/* ------------------------------------------------------------------ */
/* Date rules                                                          */
/* ------------------------------------------------------------------ */

/** Day-of-month of the `n`-th `weekday` (0=Sun … 6=Sat) of a month. */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  n: number
): number {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (weekday - firstDow + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

/**
 * Gregorian Easter Sunday (Anonymous / "Meeus-Jones-Butcher" computus).
 * Returns the month/day of Easter Sunday for `year`. The Danish
 * påske-tilbud cadence keys off Easter, which drifts across March/April,
 * so a fixed date won't do.
 */
function easterSunday(year: number): SeasonalEventDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const fixed = (month: number, day: number) => () => ({ month, day });

/**
 * The curated event set, in rough calendar order. Keyword lists lean
 * deliberately conservative — a missed match is invisible, but a false
 * positive ("July" reading as Christmas) is a confusing wrong number on
 * a stats page.
 */
export const SEASONAL_EVENTS: SeasonalEvent[] = [
  {
    id: "new-year",
    label: "New Year",
    emoji: "🎆",
    keywords: ["new year", "new year's", "nytår", "nytaar", "godt nytår"],
    dateForYear: fixed(1, 1)
  },
  {
    id: "valentines",
    label: "Valentine's Day",
    emoji: "💝",
    keywords: ["valentine", "valentines", "valentine's", "valentins", "valentinsdag"],
    dateForYear: fixed(2, 14)
  },
  {
    id: "easter",
    label: "Easter",
    emoji: "🐣",
    keywords: ["easter", "påske", "paaske", "påsketilbud", "påskeæg"],
    dateForYear: easterSunday
  },
  {
    id: "mothers-day",
    label: "Mother's Day",
    emoji: "🌷",
    keywords: ["mother's day", "mothers day", "mors dag", "morsdag"],
    // Denmark: second Sunday of May.
    dateForYear: (year) => ({ month: 5, day: nthWeekdayOfMonth(year, 5, 0, 2) })
  },
  {
    id: "fathers-day",
    label: "Father's Day",
    emoji: "👔",
    keywords: ["father's day", "fathers day", "fars dag", "farsdag"],
    // Denmark: June 5 (Constitution Day doubles as Fars dag).
    dateForYear: fixed(6, 5)
  },
  {
    id: "midsummer",
    label: "Midsummer",
    emoji: "🔥",
    keywords: ["midsummer", "sankt hans", "sankthans", "skt. hans", "sankthansaften"],
    dateForYear: fixed(6, 23)
  },
  {
    id: "halloween",
    label: "Halloween",
    emoji: "🎃",
    keywords: ["halloween"],
    dateForYear: fixed(10, 31)
  },
  {
    id: "singles-day",
    label: "Singles' Day",
    emoji: "🛍️",
    keywords: ["singles day", "singles' day", "single's day"],
    dateForYear: fixed(11, 11)
  },
  {
    id: "black-friday",
    label: "Black Friday",
    emoji: "🏷️",
    keywords: ["black friday", "black week", "blackfriday", "black-friday", "cyber monday"],
    // Fourth Friday of November.
    dateForYear: (year) => ({ month: 11, day: nthWeekdayOfMonth(year, 11, 5, 4) })
  },
  {
    id: "christmas",
    label: "Christmas",
    emoji: "🎄",
    keywords: ["christmas", "xmas", "x-mas", "jul", "julegave", "juletilbud", "julegaver"],
    // Denmark celebrates on the 24th; that's the anchor the run-up builds toward.
    dateForYear: fixed(12, 24)
  }
];

export function findSeasonalEvent(id: string): SeasonalEvent | null {
  return SEASONAL_EVENTS.find((event) => event.id === id) ?? null;
}

/* ------------------------------------------------------------------ */
/* Keyword matching                                                    */
/* ------------------------------------------------------------------ */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a single Unicode-aware matcher for an event's keyword set.
 *
 * We bound each phrase with non-letter/non-digit edges rather than the
 * ASCII `\b`, because `\b` mishandles the diacritics our Danish keywords
 * rely on ("påske", "nytår"). A leading consuming group (instead of a
 * lookbehind) keeps the regex portable to every browser the admin app
 * runs in.
 */
export function buildEventMatcher(keywords: string[]): (text: string) => boolean {
  const alternation = keywords
    .map((keyword) => escapeRegExp(keyword.trim()))
    .filter(Boolean)
    .join("|");
  if (!alternation) return () => false;
  const re = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`,
    "iu"
  );
  return (text: string) => {
    if (!text) return false;
    // Normalise curly apostrophes so "father's" keywords still match
    // typographic subject lines.
    return re.test(text.replace(/[‘’]/g, "'"));
  };
}

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

export type SeasonalEmailInput = {
  /** Opaque id carried through to the matched output so callers can map a
   *  marker back to the source email (e.g. to open it). Optional so the
   *  pure analysis stays usable without one. */
  id?: string;
  subject: string;
  preheader?: string | null;
  receivedAt: string;
};

export type SeasonalRunupEmail = {
  id: string;
  subject: string;
  receivedAt: string;
  /** The year of the event occurrence this email leads up to. */
  eventYear: number;
  /** Calendar days the email was sent before the event (0 = event day). */
  daysBefore: number;
};

export type SeasonalRunup = {
  /** Total emails in the run-up window across every occurrence. */
  matchedCount: number;
  /** Distinct event occurrences (years) that saw at least one email. */
  occurrences: number;
  /**
   * Typical lead time: the median, across occurrences, of how many days
   * before the event the *first* mention landed. The headline answer to
   * "how far ahead do they start?". `null` when nothing matched.
   */
  typicalLeadDays: number | null;
  /** The single earliest lead seen across all occurrences. */
  earliestLeadDays: number | null;
  perOccurrence: { year: number; count: number; leadDays: number }[];
  /** Matched emails, sorted earliest-first (largest `daysBefore` first). */
  emails: SeasonalRunupEmail[];
  /** Send counts bucketed by whole weeks before the event (index = weeks). */
  weekly: number[];
  /** Number of week buckets the timeline should span (>= MIN_WEEKS). */
  maxWeeks: number;
  /** The week bucket carrying the most sends, or `null` when empty. */
  peakWeeksBefore: number | null;
  /** `YYYY-MM-DD` of the upcoming occurrence, for the timeline's flag label. */
  referenceEventDate: string;
};

/**
 * Furthest ahead (in days) an email still counts as part of the run-up.
 * ~4 months comfortably covers even the earliest "holiday gift guide"
 * teaser while excluding last-year's leftovers.
 */
const WINDOW_BEFORE_DAYS = 120;
/** Minimum weeks the timeline spans so a tight run-up still has an axis. */
const MIN_WEEKS = 4;

/** `YYYY-MM-DD` for an event's occurrence in a specific year. */
function eventDayKey(event: SeasonalEvent, year: number): string {
  const { month, day } = event.dateForYear(year);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
    day
  ).padStart(2, "0")}`;
}

/**
 * The upcoming occurrence of `event` relative to `now` (or this year's
 * if it hasn't passed). Used to label the timeline flag with a concrete,
 * forward-looking date.
 */
export function upcomingOccurrence(
  event: SeasonalEvent,
  now: Date = new Date(),
  zone?: TimeZone
): string {
  const { year } = getZonedParts(now, zone);
  const todayKey = formatDayKey(now, zone);
  const thisYear = eventDayKey(event, year);
  return thisYear >= todayKey ? thisYear : eventDayKey(event, year + 1);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Counts how many emails in `emails` mention `event` at all (anywhere in
 * the sample, ignoring the run-up window). Powers the per-chip badges so
 * the user can see which events a brand actually talks about before
 * picking one.
 */
export function countEventMentions(
  emails: SeasonalEmailInput[],
  event: SeasonalEvent
): number {
  const matches = buildEventMatcher(event.keywords);
  let count = 0;
  for (const email of emails) {
    if (matches(`${email.subject ?? ""} ${email.preheader ?? ""}`)) count += 1;
  }
  return count;
}

/**
 * Builds the full run-up analysis for one brand + one event.
 *
 * For every keyword-matched email we attribute it to the *next* event
 * occurrence on or after the send (checking the email's year and the two
 * neighbours so a late-December "New Year" teaser maps to January). Sends
 * that don't fall inside the look-ahead window are dropped. From the
 * survivors we derive the per-occurrence first-mention (lead time), the
 * weekly build-up histogram, and the headline medians.
 */
export function analyzeSeasonalRunup(
  emails: SeasonalEmailInput[],
  event: SeasonalEvent,
  options: { now?: Date; zone?: TimeZone } = {}
): SeasonalRunup {
  const now = options.now ?? new Date();
  const zone = options.zone;
  const matches = buildEventMatcher(event.keywords);

  const matched: SeasonalRunupEmail[] = [];
  for (const email of emails) {
    const text = `${email.subject ?? ""} ${email.preheader ?? ""}`;
    if (!matches(text)) continue;
    const sent = new Date(email.receivedAt);
    if (Number.isNaN(sent.getTime())) continue;

    // Attribute to the closest upcoming occurrence: smallest non-negative
    // days-before across the email's year and its two neighbours.
    const { year } = getZonedParts(sent, zone);
    let best: { eventYear: number; daysBefore: number } | null = null;
    for (const candidateYear of [year - 1, year, year + 1]) {
      const eventInstant = parseDayKey(eventDayKey(event, candidateYear), zone);
      if (!eventInstant) continue;
      const daysBefore = differenceInCalendarDays(sent, eventInstant, zone);
      if (daysBefore < 0 || daysBefore > WINDOW_BEFORE_DAYS) continue;
      if (!best || daysBefore < best.daysBefore) {
        best = { eventYear: candidateYear, daysBefore };
      }
    }
    if (!best) continue;
    matched.push({
      id: email.id ?? "",
      subject: email.subject,
      receivedAt: email.receivedAt,
      eventYear: best.eventYear,
      daysBefore: best.daysBefore
    });
  }

  matched.sort((a, b) => b.daysBefore - a.daysBefore);

  const referenceEventDate = upcomingOccurrence(event, now, zone);

  if (matched.length === 0) {
    return {
      matchedCount: 0,
      occurrences: 0,
      typicalLeadDays: null,
      earliestLeadDays: null,
      perOccurrence: [],
      emails: [],
      weekly: new Array(MIN_WEEKS).fill(0),
      maxWeeks: MIN_WEEKS,
      peakWeeksBefore: null,
      referenceEventDate
    };
  }

  // Group by occurrence to derive each year's first-mention lead time.
  const byYear = new Map<number, SeasonalRunupEmail[]>();
  for (const email of matched) {
    const list = byYear.get(email.eventYear) ?? [];
    list.push(email);
    byYear.set(email.eventYear, list);
  }
  const perOccurrence = Array.from(byYear.entries())
    .map(([year, list]) => ({
      year,
      count: list.length,
      leadDays: Math.max(...list.map((e) => e.daysBefore))
    }))
    .sort((a, b) => b.year - a.year);

  const earliestLeadDays = Math.max(...perOccurrence.map((o) => o.leadDays));
  const typicalLeadDays = median(perOccurrence.map((o) => o.leadDays));

  const maxWeeks = Math.max(MIN_WEEKS, Math.ceil((earliestLeadDays + 1) / 7));
  const weekly = new Array(maxWeeks).fill(0);
  for (const email of matched) {
    const bucket = Math.min(maxWeeks - 1, Math.floor(email.daysBefore / 7));
    weekly[bucket] += 1;
  }

  let peakWeeksBefore: number | null = null;
  let peakCount = -1;
  for (let w = 0; w < weekly.length; w++) {
    if (weekly[w] > peakCount) {
      peakCount = weekly[w];
      peakWeeksBefore = w;
    }
  }

  return {
    matchedCount: matched.length,
    occurrences: perOccurrence.length,
    typicalLeadDays,
    earliestLeadDays,
    perOccurrence,
    emails: matched,
    weekly,
    maxWeeks,
    peakWeeksBefore,
    referenceEventDate
  };
}
