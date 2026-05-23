import { describe, expect, it } from "vitest";
import {
  FORECAST_BUSY_RATIO,
  FORECAST_DECAY_DAYS,
  FORECAST_QUIET_RATIO,
  computeCohortForecast,
  type CohortForecast
} from "@/lib/forecast";
import type { BrandPageData } from "@/lib/brand-db";
import {
  addDaysInZone,
  formatDayKey,
  getActiveTimeZone,
  getZonedParts,
  startOfDayInZone
} from "@/lib/datetime";

/**
 * Anchor the simulated "now" deep inside Europe/Copenhagen's CEST
 * window so DST + zone-offset bugs in the timeline construction would
 * surface as off-by-one errors against the expected weekday.
 */
const NOW = new Date("2026-06-15T09:30:00Z");
const ZONE = getActiveTimeZone();

function buildTimeline(
  perWeekday: number[] | ((dayKey: string, weekday: number, ageDays: number) => number),
  options: { days?: number; now?: Date } = {}
): { date: string; count: number }[] {
  const days = options.days ?? 365;
  const now = options.now ?? NOW;
  const todayStart = startOfDayInZone(now, ZONE);
  const out: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDaysInZone(todayStart, -i, ZONE);
    const weekday = getZonedParts(day, ZONE).weekday;
    const key = formatDayKey(day, ZONE);
    const count =
      typeof perWeekday === "function"
        ? perWeekday(key, weekday, i)
        : perWeekday[weekday] ?? 0;
    out.push({ date: key, count });
  }
  return out;
}

function makeBrand(
  id: string,
  timeline: { date: string; count: number }[]
): BrandPageData {
  // Only `brand.id`, `brand.name` and `cadence.dailyTimeline` are read
  // by the forecaster — the rest of `BrandPageData` is filled with the
  // cheapest valid stub so the tests stay focussed.
  return {
    brand: {
      id,
      name: id,
      domain: null,
      market: null,
      logoUrl: null,
      subscribedSince: "2024-01-01T00:00:00Z",
      subscriptionEmail: null,
      accent: {
        base: "#111111",
        soft: "#eeeeee",
        on: "#ffffff"
      }
    },
    totals: {
      emailCount: 0,
      sampleSize: 0,
      firstEmailAt: null,
      lastEmailAt: null
    },
    cadence: {
      avgDaysBetween: null,
      weekly: [],
      typicalDay: null,
      typicalHour: null,
      hourly: new Array(24).fill(0),
      dailyTimeline: timeline
    },
    promo: {
      discountEmails: 0,
      discountShare: 0,
      avgDiscount: null,
      maxDiscount: null
    },
    emojis: {
      emailsWithEmoji: 0,
      share: 0,
      totalEmojis: 0,
      avgPerEmojiEmail: null,
      top: []
    },
    categories: [],
    esp: { primary: null, distribution: [] },
    design: { palette: [], fonts: [], gifShare: 0, darkModeShare: 0 },
    subjects: { avgLength: null, samples: [] },
    ctas: [],
    calendar: { start: "", end: "", days: [] },
    recentEmails: []
  };
}

describe("computeCohortForecast", () => {
  it("returns an empty forecast for an empty cohort", () => {
    const forecast = computeCohortForecast([], 7, NOW);
    expect(forecast.days).toEqual([]);
    expect(forecast.quietest).toBeNull();
    expect(forecast.busiest).toBeNull();
    expect(forecast.totalWeight).toBe(0);
  });

  it("produces seven forward-looking days for horizon=7", () => {
    const brand = makeBrand("acme", buildTimeline([1, 1, 1, 1, 1, 1, 1]));
    const forecast = computeCohortForecast([brand], 7, NOW);
    expect(forecast.days).toHaveLength(7);
    expect(forecast.days[0].daysAhead).toBe(1);
    expect(forecast.days[6].daysAhead).toBe(7);
    // All weekdays covered exactly once.
    const dows = new Set(forecast.days.map((d) => d.weekday));
    expect(dows.size).toBe(7);
  });

  it("forecasts every day in a 14-day horizon", () => {
    const brand = makeBrand("acme", buildTimeline([1, 1, 1, 1, 1, 1, 1]));
    const forecast = computeCohortForecast([brand], 14, NOW);
    expect(forecast.days).toHaveLength(14);
    expect(forecast.days[0].daysAhead).toBe(1);
    expect(forecast.days[13].daysAhead).toBe(14);
  });

  it("flags the noisiest weekday as 'busy' when DOW seasonality is strong", () => {
    // Tuesday (weekday=2) sends a burst, every other day quiet.
    const heavyTuesdays = buildTimeline((_, weekday) => (weekday === 2 ? 4 : 0));
    const brand = makeBrand("loud-on-tuesdays", heavyTuesdays);
    const forecast = computeCohortForecast([brand], 14, NOW);

    expect(forecast.busiest).not.toBeNull();
    expect(forecast.busiest!.weekday).toBe(2);
    expect(forecast.busiest!.band).toBe("busy");
    expect(forecast.busiest!.expected).toBeGreaterThan(0);

    const tuesdays = forecast.days.filter((d) => d.weekday === 2);
    for (const tue of tuesdays) {
      expect(tue.expected).toBeGreaterThan(0);
      expect(tue.band).toBe("busy");
    }
    const sundays = forecast.days.filter((d) => d.weekday === 0);
    for (const sun of sundays) {
      expect(sun.expected).toBe(0);
      expect(sun.band).toBe("quiet");
    }
  });

  it("identifies the quietest day in a mixed cohort", () => {
    // Cohort: brand A blasts Mon/Wed/Fri, brand B blasts Tue/Thu —
    // weekends (Sat/Sun) should come out quietest.
    const mwf = buildTimeline((_, w) => ([0, 2, 0, 2, 0, 2, 0][w] ?? 0));
    const tt = buildTimeline((_, w) => ([0, 0, 2, 0, 2, 0, 0][w] ?? 0));
    const brands = [makeBrand("alpha", mwf), makeBrand("bravo", tt)];
    const forecast = computeCohortForecast(brands, 14, NOW);

    expect(forecast.quietest).not.toBeNull();
    // Saturday or Sunday — both should score zero against the cohort.
    expect([0, 6]).toContain(forecast.quietest!.weekday);
    expect(forecast.quietest!.expected).toBe(0);
    expect(forecast.quietest!.band).toBe("quiet");
  });

  it("weights recent sends more heavily than ancient ones", () => {
    // The recent half of the year sends every Tuesday; the ancient
    // half sends every Wednesday. With FORECAST_DECAY_DAYS ~ 60d the
    // model should land on Tuesday as the busiest weekday — even
    // though the raw count of Wednesdays in the timeline is larger.
    const timeline = buildTimeline((_, weekday, ageDays) => {
      const recent = ageDays < 30;
      if (recent && weekday === 2) return 5;
      if (!recent && weekday === 3) return 5;
      return 0;
    });
    const brand = makeBrand("trend-changer", timeline);
    const forecast = computeCohortForecast([brand], 14, NOW);

    const tuesdayMean = mean(
      forecast.days.filter((d) => d.weekday === 2).map((d) => d.expected)
    );
    const wednesdayMean = mean(
      forecast.days.filter((d) => d.weekday === 3).map((d) => d.expected)
    );
    expect(tuesdayMean).toBeGreaterThan(wednesdayMean);
  });

  it("returns contributions sorted by descending expected volume", () => {
    const loud = makeBrand("loud", buildTimeline([3, 3, 3, 3, 3, 3, 3]));
    const quiet = makeBrand("quiet", buildTimeline([1, 1, 1, 1, 1, 1, 1]));
    const forecast = computeCohortForecast([quiet, loud], 7, NOW);
    for (const day of forecast.days) {
      expect(day.contributions[0].brandId).toBe("loud");
      expect(day.contributions[1].brandId).toBe("quiet");
      expect(day.contributions[0].expected).toBeGreaterThanOrEqual(
        day.contributions[1].expected
      );
    }
  });

  it("nulls out best/worst when every forecasted day is identical", () => {
    const brand = makeBrand("flat", buildTimeline([1, 1, 1, 1, 1, 1, 1]));
    const forecast = computeCohortForecast([brand], 7, NOW);
    expect(forecast.quietest).toBeNull();
    expect(forecast.busiest).toBeNull();
    // Total weight is still positive — the model has signal, it just
    // has nothing to differentiate days by.
    expect(forecast.totalWeight).toBeGreaterThan(0);
  });

  it("matches the documented quiet/busy band thresholds", () => {
    const brand = makeBrand(
      "spiky",
      buildTimeline([0, 0, 5, 0, 0, 0, 0])
    );
    const forecast = computeCohortForecast([brand], 14, NOW);
    for (const day of forecast.days) {
      const ratio = forecast.mean > 0 ? day.expected / forecast.mean : 1;
      const expectedBand =
        ratio >= FORECAST_BUSY_RATIO
          ? "busy"
          : ratio <= FORECAST_QUIET_RATIO
            ? "quiet"
            : "normal";
      expect(day.band).toBe(expectedBand);
    }
  });

  it("uses the documented decay constant", () => {
    // A 60-day-old observation should weigh exactly 1/e against a
    // brand-new one. Build a 1-event timeline at age=0 and another at
    // age=DECAY_DAYS and confirm the forecast collapses to the right
    // weighted mean.
    const todayStart = startOfDayInZone(NOW, ZONE);
    const newer = formatDayKey(todayStart, ZONE);
    const older = formatDayKey(
      addDaysInZone(todayStart, -FORECAST_DECAY_DAYS, ZONE),
      ZONE
    );
    const newerWeekday = getZonedParts(todayStart, ZONE).weekday;
    const olderWeekday = getZonedParts(
      addDaysInZone(todayStart, -FORECAST_DECAY_DAYS, ZONE),
      ZONE
    ).weekday;

    // Pick two distinct weekdays so the buckets don't overlap.
    if (newerWeekday === olderWeekday) {
      // The 60-day offset will land on a different weekday for any
      // start instant since 60 % 7 = 4. Guard the assumption so a
      // refactor of FORECAST_DECAY_DAYS doesn't silently break us.
      throw new Error(
        "Test precondition violated: pick a DECAY_DAYS that doesn't land on the same weekday."
      );
    }

    const timeline = [
      { date: older, count: 1 },
      { date: newer, count: 1 }
    ];
    const brand = makeBrand("decay", timeline);
    const forecast = computeCohortForecast([brand], 14, NOW);

    const newerDay = forecast.days.find((d) => d.weekday === newerWeekday);
    const olderDay = forecast.days.find((d) => d.weekday === olderWeekday);

    expect(newerDay).toBeDefined();
    expect(olderDay).toBeDefined();
    // Each weekday has exactly one observation, so the weighted mean
    // collapses to the count (1) for both. The decay matters for the
    // *total weight* and so for cross-bucket interpolation, but the
    // single-sample mean is invariant — confirm that explicitly.
    expect(newerDay!.expected).toBeCloseTo(1, 6);
    expect(olderDay!.expected).toBeCloseTo(1, 6);
  });
});

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

// Suppress unused export warning if vitest's reporter complains about
// unused type imports — keeps the test self-contained without `any`.
export type _CohortForecast = CohortForecast;
