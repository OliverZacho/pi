import { describe, expect, it } from "vitest";
import {
  PLATFORM_TIMEZONE,
  addDaysInZone,
  differenceInCalendarDays,
  endOfDayInZone,
  formatDayKey,
  formatHourOfDay,
  formatLongDate,
  formatRelativeDate,
  formatTime,
  getActiveTimeZone,
  getZoneAbbreviation,
  getZoneOffsetMinutes,
  getZonedParts,
  startOfDayInZone,
  startOfWeekInZone,
  startOfYearInZone
} from "@/lib/datetime";

describe("PLATFORM_TIMEZONE", () => {
  it("standardises on Europe/Copenhagen", () => {
    expect(PLATFORM_TIMEZONE).toBe("Europe/Copenhagen");
    expect(getActiveTimeZone()).toBe(PLATFORM_TIMEZONE);
  });
});

describe("getZoneOffsetMinutes", () => {
  it("returns +120 (CEST) in summer for Copenhagen", () => {
    expect(
      getZoneOffsetMinutes(new Date("2026-07-15T10:00:00Z"), "Europe/Copenhagen")
    ).toBe(120);
  });

  it("returns +60 (CET) in winter for Copenhagen", () => {
    expect(
      getZoneOffsetMinutes(new Date("2026-01-15T10:00:00Z"), "Europe/Copenhagen")
    ).toBe(60);
  });

  it("returns 0 for UTC", () => {
    expect(getZoneOffsetMinutes(new Date("2026-07-15T10:00:00Z"), "UTC")).toBe(0);
  });
});

describe("getZoneAbbreviation", () => {
  it("returns CEST in Copenhagen summer", () => {
    expect(
      getZoneAbbreviation(new Date("2026-07-15T10:00:00Z"), "Europe/Copenhagen")
    ).toBe("CEST");
  });

  it("returns CET in Copenhagen winter", () => {
    expect(
      getZoneAbbreviation(new Date("2026-01-15T10:00:00Z"), "Europe/Copenhagen")
    ).toBe("CET");
  });
});

describe("getZonedParts", () => {
  it("reads wall-clock fields in the platform zone", () => {
    // 2026-07-15 23:30 UTC -> 2026-07-16 01:30 CEST
    const parts = getZonedParts(new Date("2026-07-15T23:30:00Z"));
    expect(parts).toMatchObject({
      year: 2026,
      month: 7,
      day: 16,
      hour: 1,
      minute: 30
    });
  });

  it("returns weekday compatible with Date#getDay", () => {
    // 2026-05-18 is a Monday in Copenhagen (a CEST day).
    const parts = getZonedParts(new Date("2026-05-18T08:00:00Z"));
    expect(parts.weekday).toBe(1);
  });
});

describe("startOfDayInZone / endOfDayInZone", () => {
  it("returns midnight Copenhagen for an instant just before it", () => {
    // 2026-07-15 21:59:59 UTC == 2026-07-15 23:59:59 CEST.
    // Start of that day in Copenhagen is 2026-07-15 00:00 CEST = 2026-07-14 22:00 UTC.
    const start = startOfDayInZone(new Date("2026-07-15T21:59:59Z"));
    expect(start.toISOString()).toBe("2026-07-14T22:00:00.000Z");
  });

  it("returns end of day in Copenhagen", () => {
    const end = endOfDayInZone(new Date("2026-07-15T10:00:00Z"));
    // End of 2026-07-15 in Copenhagen = 23:59:59.999 CEST = 21:59:59.999 UTC.
    expect(end.toISOString()).toBe("2026-07-15T21:59:59.999Z");
  });

  it("handles the winter offset correctly", () => {
    // 2026-01-15 10:00 UTC -> 11:00 CET. Start of 2026-01-15 CET = 23:00 UTC the day before.
    const start = startOfDayInZone(new Date("2026-01-15T10:00:00Z"));
    expect(start.toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });
});

describe("addDaysInZone", () => {
  it("preserves the wall-clock hour across DST spring-forward", () => {
    // 2026-03-29 is the Copenhagen DST transition. 09:00 CET on 2026-03-28
    // (08:00 UTC) plus one calendar day should land at 09:00 CEST on
    // 2026-03-29 (07:00 UTC) — the wall clock is preserved, not the
    // 86_400_000ms increment.
    const tomorrow = addDaysInZone(new Date("2026-03-28T08:00:00Z"), 1);
    expect(tomorrow.toISOString()).toBe("2026-03-29T07:00:00.000Z");
  });

  it("wraps month boundaries correctly", () => {
    const result = addDaysInZone(new Date("2026-07-31T10:00:00Z"), 1);
    const parts = getZonedParts(result);
    expect(parts.month).toBe(8);
    expect(parts.day).toBe(1);
  });
});

describe("startOfWeekInZone", () => {
  it("snaps back to the most recent Monday in Copenhagen", () => {
    // 2026-05-20 is a Wednesday. Monday of that week is 2026-05-18.
    const monday = startOfWeekInZone(new Date("2026-05-20T15:00:00Z"));
    const parts = getZonedParts(monday);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(5);
    expect(parts.day).toBe(18);
    expect(parts.hour).toBe(0);
  });

  it("returns the same Monday when given a Monday", () => {
    const monday = startOfWeekInZone(new Date("2026-05-18T15:00:00Z"));
    expect(getZonedParts(monday).day).toBe(18);
  });
});

describe("startOfYearInZone", () => {
  it("returns Jan 1 00:00 Copenhagen", () => {
    const start = startOfYearInZone(new Date("2026-05-18T15:00:00Z"));
    // Jan 1 00:00 CET (winter) = Dec 31 23:00 UTC.
    expect(start.toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });
});

describe("differenceInCalendarDays", () => {
  it("returns zero when the two instants share a Copenhagen calendar day", () => {
    // Both 2026-05-18 in Copenhagen (CEST).
    const diff = differenceInCalendarDays(
      new Date("2026-05-18T05:00:00Z"),
      new Date("2026-05-18T20:00:00Z")
    );
    expect(diff).toBe(0);
  });

  it("crosses the Copenhagen midnight boundary correctly", () => {
    // 23:55 Copenhagen on Mon = 21:55 UTC; 00:05 Tue Copenhagen = 22:05 UTC.
    // Two distinct calendar days in Copenhagen even though wall-clock UTC is contiguous.
    const diff = differenceInCalendarDays(
      new Date("2026-05-18T21:55:00Z"),
      new Date("2026-05-18T22:05:00Z")
    );
    expect(diff).toBe(1);
  });

  it("returns negative values when 'to' is earlier than 'from'", () => {
    expect(
      differenceInCalendarDays(
        new Date("2026-05-18T10:00:00Z"),
        new Date("2026-05-15T10:00:00Z")
      )
    ).toBe(-3);
  });
});

describe("formatDayKey", () => {
  it("emits YYYY-MM-DD in Copenhagen", () => {
    expect(formatDayKey(new Date("2026-05-18T22:30:00Z"))).toBe("2026-05-19");
  });

  it("falls back to UTC keys when explicitly asked", () => {
    expect(formatDayKey(new Date("2026-05-18T22:30:00Z"), "UTC")).toBe("2026-05-18");
  });
});

describe("formatters", () => {
  const summerInstant = new Date("2026-05-18T08:30:00Z"); // 10:30 CEST

  it("formatTime renders Copenhagen-local clock", () => {
    expect(formatTime(summerInstant, { locale: "en-GB" })).toContain("10:30");
  });

  it("formatLongDate uses the correct Copenhagen day", () => {
    // 23:30 UTC -> next-day in Copenhagen.
    const result = formatLongDate(new Date("2026-05-18T22:30:00Z"), {
      locale: "en-US"
    });
    expect(result).toContain("19");
  });

  it("formatRelativeDate handles calendar boundaries", () => {
    const yesterday = addDaysInZone(new Date(), -1);
    expect(formatRelativeDate(yesterday)).toBe("yesterday");
    expect(formatRelativeDate(new Date())).toBe("today");
  });

  it("formatHourOfDay produces a clock label, optionally with the zone", () => {
    expect(formatHourOfDay(9)).toBe("9 AM");
    expect(formatHourOfDay(13, { case: "lower" })).toBe("1pm");
    const labelled = formatHourOfDay(9, {
      withZone: true,
      referenceInstant: summerInstant
    });
    expect(labelled).toBe("9 AM CEST");
  });

  it("formatters return the fallback for invalid input", () => {
    expect(formatTime(null)).toBe("-");
    expect(formatLongDate("not-a-date", { fallback: "—" })).toBe("—");
  });
});
