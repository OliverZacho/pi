/**
 * Centralised time-zone + date formatting helpers.
 *
 * The platform standardises on a single IANA time zone (currently
 * `Europe/Copenhagen`). Every user-facing date in the product is
 * rendered in this zone, and every server-side "today" / "start of
 * day" / "calendar bucket" computation uses it. Storing instants as
 * `timestamptz` in Postgres + presenting them in this zone is what
 * makes "Mon at 09:00 CEST" mean the same thing for every viewer
 * regardless of where their browser thinks they live.
 *
 * The IANA zone is intentional: `Europe/Copenhagen` resolves to
 * **CEST in summer** and **CET in winter** automatically. Hard-coding
 * `+02:00` would silently lie for half the year, so we always go
 * through `Intl` with the zone name and let the runtime do the DST
 * math.
 *
 * Per-user time zones are not yet wired up. `getActiveTimeZone()` is
 * the single place to extend later — once we add a `timezone` column
 * (or auth metadata) we can plumb the user's value through this one
 * function and every formatter / bucket boundary in the app will
 * respect it without further edits.
 */

/** The platform's default IANA time zone. */
export const PLATFORM_TIMEZONE = "Europe/Copenhagen" as const;

/** Convenient alias for callers that want to be explicit about intent. */
export type TimeZone = string;

/**
 * Returns the active time zone for the current request / render.
 *
 * Today this is always {@link PLATFORM_TIMEZONE}. When per-user time
 * zones land, this is where we'll read the preference from the
 * session / profile and fall back to the platform default for
 * unauthenticated views and marketing pages.
 */
export function getActiveTimeZone(): TimeZone {
  return PLATFORM_TIMEZONE;
}

/**
 * Coerces an ISO string / number / Date into a `Date`. Returns `null`
 * if the input cannot be parsed. The formatters use this so a single
 * bad row in the DB never throws — the caller decides what to render
 * in its place ("-", "—", the original string, etc.).
 */
function toDate(input: Date | string | number | null | undefined): Date | null {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ------------------------------------------------------------------ */
/* Zoned wall-clock parts + offset                                     */
/* ------------------------------------------------------------------ */

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

export type ZonedParts = {
  year: number;
  /** 1-12, matching the human calendar (not 0-11 like `Date#getMonth`). */
  month: number;
  /** 1-31. */
  day: number;
  /** 0-23. */
  hour: number;
  /** 0-59. */
  minute: number;
  /** 0-59. */
  second: number;
  /** 0 = Sunday … 6 = Saturday, matching `Date#getDay`. */
  weekday: number;
};

/**
 * Returns the wall-clock fields of `instant` as observed in `zone`.
 *
 * This is the foundation for "what calendar day is this email in
 * Copenhagen?" — we never trust the host's local zone for product
 * logic.
 */
export function getZonedParts(
  instant: Date | string | number,
  zone: TimeZone = getActiveTimeZone()
): ZonedParts {
  const date = toDate(instant);
  if (!date) {
    throw new RangeError(`Invalid date passed to getZonedParts: ${String(instant)}`);
  }
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short"
  });
  const lookup: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") {
      lookup[part.type] = part.value;
    }
  }
  // `hour` can come back as "24" at midnight in some ICU builds; treat
  // that as 0 so all callers see a normal 0-23 range.
  let hour = Number(lookup.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour,
    minute: Number(lookup.minute),
    second: Number(lookup.second),
    weekday: WEEKDAY_INDEX[lookup.weekday] ?? 0
  };
}

/**
 * Returns the offset (in minutes ahead of UTC) for `instant` as seen
 * from `zone`. Copenhagen returns `+60` in winter and `+120` in
 * summer.
 */
export function getZoneOffsetMinutes(
  instant: Date | string | number,
  zone: TimeZone = getActiveTimeZone()
): number {
  const date = toDate(instant);
  if (!date) {
    throw new RangeError(
      `Invalid date passed to getZoneOffsetMinutes: ${String(instant)}`
    );
  }
  const parts = getZonedParts(date, zone);
  // Express the zoned wall clock as if it were UTC, then compare to
  // the actual instant. The signed difference is the zone offset.
  const wallAsUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return Math.round((wallAsUtcMs - date.getTime()) / 60_000);
}

/**
 * Returns the standard short abbreviation for the zone at `instant`
 * (e.g. "CEST" / "CET" for Copenhagen). Falls back to a `GMT±H`
 * string if the runtime doesn't surface a name.
 */
export function getZoneAbbreviation(
  instant: Date | string | number = new Date(),
  zone: TimeZone = getActiveTimeZone()
): string {
  const date = toDate(instant) ?? new Date();
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    timeZoneName: "short"
  });
  const tzPart = dtf
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName");
  // ICU usually returns "CET" / "CEST" for `en-GB` + `Europe/Copenhagen`.
  // If we get something like "GMT+1" we synthesise the locally-expected
  // abbreviation for the European zones we actually use; otherwise we
  // hand back whatever ICU produced so we don't lie about the zone.
  if (tzPart && /^[A-Z]{2,5}$/.test(tzPart.value)) return tzPart.value;
  if (zone === "Europe/Copenhagen" || zone === "Europe/Berlin") {
    return getZoneOffsetMinutes(date, zone) === 120 ? "CEST" : "CET";
  }
  return tzPart?.value ?? "UTC";
}

/* ------------------------------------------------------------------ */
/* Calendar boundaries                                                 */
/* ------------------------------------------------------------------ */

/**
 * Resolves the `Date` instant that corresponds to `year-month-day
 * hh:mm:ss` **as observed in `zone`**.
 *
 * The implementation guesses the offset, snaps the wall clock to UTC,
 * then re-checks the offset for the candidate instant and corrects
 * once. The double-check matters across DST transitions where the
 * naïve guess can land an hour off.
 */
function instantForZonedWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  zone: TimeZone
): Date {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const offset1 = getZoneOffsetMinutes(new Date(naiveUtcMs), zone);
  const candidate = new Date(naiveUtcMs - offset1 * 60_000);
  const offset2 = getZoneOffsetMinutes(candidate, zone);
  if (offset2 === offset1) return candidate;
  return new Date(naiveUtcMs - offset2 * 60_000);
}

/** First instant of the calendar day that `instant` falls on in `zone`. */
export function startOfDayInZone(
  instant: Date | string | number,
  zone: TimeZone = getActiveTimeZone()
): Date {
  const { year, month, day } = getZonedParts(instant, zone);
  return instantForZonedWallClock(year, month, day, 0, 0, 0, 0, zone);
}

/** Last representable instant (`23:59:59.999`) of the same day in `zone`. */
export function endOfDayInZone(
  instant: Date | string | number,
  zone: TimeZone = getActiveTimeZone()
): Date {
  const { year, month, day } = getZonedParts(instant, zone);
  return instantForZonedWallClock(year, month, day, 23, 59, 59, 999, zone);
}

/**
 * Adds `days` calendar days to `instant`, anchored in `zone`. Unlike
 * `+ N * 86_400_000` this respects the daylight-saving boundary, so
 * "tomorrow at 09:00 in Copenhagen" stays at 09:00 even across the
 * spring-forward / fall-back transitions.
 */
export function addDaysInZone(
  instant: Date | string | number,
  days: number,
  zone: TimeZone = getActiveTimeZone()
): Date {
  const parts = getZonedParts(instant, zone);
  return instantForZonedWallClock(
    parts.year,
    parts.month,
    parts.day + days,
    parts.hour,
    parts.minute,
    parts.second,
    0,
    zone
  );
}

/** First instant of the most recent Monday on or before `instant`, in `zone`. */
export function startOfWeekInZone(
  instant: Date | string | number,
  zone: TimeZone = getActiveTimeZone()
): Date {
  const parts = getZonedParts(instant, zone);
  // Monday-start week. `weekday` is 0 (Sun) … 6 (Sat); the offset back
  // to Monday is `(weekday + 6) % 7`.
  const backToMonday = (parts.weekday + 6) % 7;
  return instantForZonedWallClock(
    parts.year,
    parts.month,
    parts.day - backToMonday,
    0,
    0,
    0,
    0,
    zone
  );
}

/** First instant of January 1 of the calendar year that contains `instant`. */
export function startOfYearInZone(
  instant: Date | string | number,
  zone: TimeZone = getActiveTimeZone()
): Date {
  const { year } = getZonedParts(instant, zone);
  return instantForZonedWallClock(year, 1, 1, 0, 0, 0, 0, zone);
}

/**
 * Difference between `from` and `to` measured in **calendar days** in
 * `zone` (not in 86,400,000 ms increments). Returns `to - from` so a
 * positive value means `to` is later.
 */
export function differenceInCalendarDays(
  from: Date | string | number,
  to: Date | string | number,
  zone: TimeZone = getActiveTimeZone()
): number {
  const a = startOfDayInZone(from, zone).getTime();
  const b = startOfDayInZone(to, zone).getTime();
  // 86_400_000 is exact at the day-boundary instants — both operands
  // are midnight in `zone` so DST does not perturb the diff.
  return Math.round((b - a) / 86_400_000);
}

/* ------------------------------------------------------------------ */
/* Formatters                                                          */
/* ------------------------------------------------------------------ */

/**
 * Lookup of `Intl.DateTimeFormat` instances keyed by `locale|zone|opts`.
 * Constructing a formatter is comparatively expensive, and we hit the
 * same handful of presets thousands of times per page render.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(
  locale: string | undefined,
  zone: TimeZone,
  opts: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${locale ?? ""}|${zone}|${JSON.stringify(opts)}`;
  let cached = formatterCache.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, { ...opts, timeZone: zone });
    formatterCache.set(key, cached);
  }
  return cached;
}

export type FormatOpts = {
  /** IANA time zone; defaults to the platform zone. */
  zone?: TimeZone;
  /** BCP-47 locale; defaults to the runtime default. */
  locale?: string;
  /** Returned when the input cannot be parsed. Defaults to `"-"`. */
  fallback?: string;
};

/** "Mon, May 18, 2026" — short weekday + short month + year. */
export function formatLongDate(
  input: Date | string | number | null | undefined,
  opts: FormatOpts = {}
): string {
  const date = toDate(input);
  if (!date) return opts.fallback ?? "-";
  return getFormatter(opts.locale, opts.zone ?? getActiveTimeZone(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

/** "Monday, May 18, 2026, 9:30 AM" — long weekday + month + clock. */
export function formatFullDateTime(
  input: Date | string | number | null | undefined,
  opts: FormatOpts = {}
): string {
  const date = toDate(input);
  if (!date) return opts.fallback ?? "-";
  return getFormatter(opts.locale, opts.zone ?? getActiveTimeZone(), {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

/** "May 18, 2026, 09:30" — concise table cell / list item formatter. */
export function formatDateTime(
  input: Date | string | number | null | undefined,
  opts: FormatOpts = {}
): string {
  const date = toDate(input);
  if (!date) return opts.fallback ?? "-";
  return getFormatter(opts.locale, opts.zone ?? getActiveTimeZone(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

/** "9:30 AM" — clock only. */
export function formatTime(
  input: Date | string | number | null | undefined,
  opts: FormatOpts = {}
): string {
  const date = toDate(input);
  if (!date) return opts.fallback ?? "-";
  return getFormatter(opts.locale, opts.zone ?? getActiveTimeZone(), {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

/** "May 18" — short calendar date for sparkline labels. */
export function formatShortDate(
  input: Date | string | number | null | undefined,
  opts: FormatOpts = {}
): string {
  const date = toDate(input);
  if (!date) return opts.fallback ?? "-";
  return getFormatter(opts.locale, opts.zone ?? getActiveTimeZone(), {
    month: "short",
    day: "numeric"
  }).format(date);
}

/** "May 2026" — month + year. */
export function formatMonthYear(
  input: Date | string | number | null | undefined,
  opts: FormatOpts = {}
): string {
  const date = toDate(input);
  if (!date) return opts.fallback ?? "-";
  return getFormatter(opts.locale, opts.zone ?? getActiveTimeZone(), {
    month: "short",
    year: "numeric"
  }).format(date);
}

/**
 * "today" / "yesterday" / "N days ago" / "N weeks ago" / "May 2026".
 *
 * All boundaries are calendar-day boundaries in `zone`, so an email
 * received at 23:55 Copenhagen time on Monday and viewed at 00:05
 * Copenhagen time on Tuesday correctly reads as "yesterday" instead
 * of accidentally rounding to "today".
 */
export function formatRelativeDate(
  input: Date | string | number | null | undefined,
  opts: FormatOpts = {}
): string {
  const date = toDate(input);
  if (!date) return opts.fallback ?? "-";
  const zone = opts.zone ?? getActiveTimeZone();
  const diffDays = differenceInCalendarDays(date, new Date(), zone);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.round(diffDays / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
  return formatMonthYear(date, opts);
}

/**
 * `YYYY-MM-DD` for the calendar day that `instant` lies in. Used as a
 * stable map key for per-day buckets in the brand calendar / heatmap.
 */
export function formatDayKey(
  instant: Date | string | number,
  zone: TimeZone = getActiveTimeZone()
): string {
  const { year, month, day } = getZonedParts(instant, zone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
    day
  ).padStart(2, "0")}`;
}

/**
 * Inverse of {@link formatDayKey}: given a `YYYY-MM-DD` day key,
 * returns a `Date` instant that lands at midday on that calendar day
 * **in `zone`**. Returns `null` for unparseable input.
 *
 * Midday is used (rather than midnight) so `Intl` formatters always
 * land on the intended calendar day even on DST-transition dates,
 * where the first hour of the local day technically does not exist.
 */
export function parseDayKey(
  iso: string,
  zone: TimeZone = getActiveTimeZone()
): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return instantForZonedWallClock(year, month, day, 12, 0, 0, 0, zone);
}

/**
 * Formats a 0-23 hour-of-day. With `withZone: true` we append the
 * platform zone's current short name (e.g. "9 AM CEST"). The
 * abbreviation is computed for `referenceInstant` (defaults to "now")
 * because Copenhagen is CEST in summer and CET in winter.
 */
export function formatHourOfDay(
  hour: number,
  opts: FormatOpts & {
    /** `"AM"` / `"am"`. Defaults to upper-case to match clock dials. */
    case?: "upper" | "lower";
    withZone?: boolean;
    referenceInstant?: Date | string | number;
  } = {}
): string {
  const safeHour = ((Math.round(hour) % 24) + 24) % 24;
  const h12 = safeHour % 12 === 0 ? 12 : safeHour % 12;
  const ampm = safeHour < 12 ? "AM" : "PM";
  const ampmCased = opts.case === "lower" ? ampm.toLowerCase() : ampm;
  const sep = opts.case === "lower" ? "" : " ";
  const base = `${h12}${sep}${ampmCased}`;
  if (!opts.withZone) return base;
  const zone = opts.zone ?? getActiveTimeZone();
  const abbr = getZoneAbbreviation(opts.referenceInstant ?? new Date(), zone);
  return `${base} ${abbr}`;
}
