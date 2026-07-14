import { describe, expect, it } from "vitest";
import {
  buildComparisonInsights,
  previousWeeklySendRate,
  reminderShare,
  urgencyShare,
  weeklySendRate
} from "@/lib/comparison-insights";
import type { BrandPageData } from "@/lib/brand-db";

/**
 * The takeaway generators are the load-bearing part of the comparison
 * dashboard — a wrong sentence is worse than no sentence. These tests
 * pin the claim thresholds (when a sentence appears at all) and the
 * shape of the claims for representative cohorts.
 */

/** Daily timeline emitting `perWeek` sends per week (integer ≤ 7). */
function timeline(perWeek: number): { date: string; count: number }[] {
  return Array.from({ length: 120 }, (_, i) => ({
    date: `2026-day-${i}`,
    count: i % 7 < perWeek ? 1 : 0
  }));
}

function makeBrand(
  name: string,
  overrides: {
    perWeek?: number;
    /** Raw daily counts (oldest first) — overrides `perWeek`. */
    timelineCounts?: number[];
    typicalDay?: { index: number; label: string; share: number } | null;
    discountShare?: number;
    avgDiscount?: number | null;
    avgSubjectLength?: number | null;
    emojiShare?: number;
    categories?: { id: string; label: string; count: number }[];
    seasonalSubjects?: {
      subject: string;
      receivedAt: string;
      discountPercent?: number | null;
      category?: string;
    }[];
  } = {}
): BrandPageData {
  return {
    brand: {
      id: `id-${name}`,
      name,
      domain: null,
      markets: [],
      primaryMarketCountry: "DK",
      marketConfidence: 1,
      isGlobal: false,
      hqCountry: "DK",
      marketSource: "email",
      marketCitation: null,
      logoUrl: null,
      subscribedSince: "2024-01-01T00:00:00Z",
      subscriptionEmail: null,
      listTabs: [],
      activeSegmentId: null,
      accent: { base: "#0f172a", foreground: "#ffffff", soft: "#f1f5f9" }
    },
    totals: {
      emailCount: 100,
      sampleSize: 100,
      firstEmailAt: "2024-01-01T00:00:00Z",
      lastEmailAt: "2026-06-01T00:00:00Z"
    },
    cadence: {
      avgDaysBetween: 3,
      weekly: [],
      typicalDay:
        overrides.typicalDay !== undefined
          ? overrides.typicalDay
          : { index: 2, label: "Tuesday", share: 0.4 },
      typicalHour: null,
      hourly: new Array(24).fill(0),
      dailyTimeline: overrides.timelineCounts
        ? overrides.timelineCounts.map((count, i) => ({
            date: `2026-day-${i}`,
            count
          }))
        : timeline(overrides.perWeek ?? 3)
    },
    promo: {
      discountEmails: 10,
      discountShare: overrides.discountShare ?? 0.2,
      avgDiscount:
        overrides.avgDiscount !== undefined ? overrides.avgDiscount : 20,
      maxDiscount: 50
    },
    emojis: {
      emailsWithEmoji: 10,
      share: overrides.emojiShare ?? 0.3,
      totalEmojis: 12,
      avgPerEmojiEmail: 1.2,
      top: []
    },
    categories: overrides.categories ?? [
      { id: "sale", label: "Sale", count: 50 },
      { id: "content", label: "Content", count: 50 }
    ],
    esp: { primary: null, distribution: [] },
    design: { palette: [], fonts: [], gifShare: 0.1, darkModeShare: 0 },
    subjects: {
      avgLength:
        overrides.avgSubjectLength !== undefined
          ? overrides.avgSubjectLength
          : 40,
      samples: []
    },
    ctas: [],
    ctaDestinations: [],
    calendar: { start: "2026-01-01", end: "2026-06-01", days: [] },
    recentEmails: [],
    seasonalSample: (overrides.seasonalSubjects ?? []).map((email, i) => ({
      id: `email-${name}-${i}`,
      subject: email.subject,
      preheader: null,
      receivedAt: email.receivedAt,
      category: email.category ?? "seasonal",
      hasGif: false,
      hasDarkMode: false,
      discountPercent: email.discountPercent ?? null,
      promoCode: null
    }))
  } as BrandPageData;
}

describe("weeklySendRate", () => {
  it("computes the average over the lookback window", () => {
    const brand = makeBrand("A", { perWeek: 3 });
    expect(weeklySendRate(brand)).toBeCloseTo(3, 1);
  });
});

describe("previousWeeklySendRate", () => {
  it("computes the rate of the window before the current one", () => {
    // 84 old days at 3/week, then 84 recent days at 1/week.
    const counts = [
      ...Array.from({ length: 84 }, (_, i) => (i % 7 < 3 ? 1 : 0)),
      ...Array.from({ length: 84 }, (_, i) => (i % 7 < 1 ? 1 : 0))
    ];
    const brand = makeBrand("A", { timelineCounts: counts });
    expect(weeklySendRate(brand)).toBeCloseTo(1, 1);
    expect(previousWeeklySendRate(brand)).toBeCloseTo(3, 1);
  });

  it("returns null without enough history for a fair baseline", () => {
    const counts = Array.from({ length: 90 }, (_, i) => (i % 7 === 0 ? 1 : 0));
    const brand = makeBrand("A", { timelineCounts: counts });
    // Only 6 days precede the 84-day window — no baseline to trend on.
    expect(previousWeeklySendRate(brand)).toBeNull();
  });
});

describe("rhythm takeaway", () => {
  it("names a clear leader and its multiple of the group pace", () => {
    const { rhythm } = buildComparisonInsights([
      makeBrand("Loud", { perWeek: 6 }),
      makeBrand("Quiet", { perWeek: 2 }),
      makeBrand("Quieter", { perWeek: 2 })
    ]);
    expect(rhythm.takeaway).toContain("Loud");
    expect(rhythm.takeaway).toContain("×");
    expect(rhythm.rows[0].name).toBe("Loud");
  });

  it("says the group is similar when the spread is small", () => {
    const { rhythm } = buildComparisonInsights([
      makeBrand("A", { perWeek: 3 }),
      makeBrand("B", { perWeek: 3 })
    ]);
    expect(rhythm.takeaway).toContain("similar pace");
  });

  it("stays silent for a single brand", () => {
    const { rhythm } = buildComparisonInsights([makeBrand("A")]);
    expect(rhythm.takeaway).toBeNull();
  });
});

describe("timing takeaway", () => {
  it("calls out a dominant day and the lone dissenter", () => {
    const tuesday = { index: 2, label: "Tuesday", share: 0.45 };
    const { timingTakeaway } = buildComparisonInsights([
      makeBrand("A", { typicalDay: tuesday }),
      makeBrand("B", { typicalDay: tuesday }),
      makeBrand("C", { typicalDay: { index: 5, label: "Friday", share: 0.5 } })
    ]);
    expect(timingTakeaway).toContain("Tuesday");
    expect(timingTakeaway).toContain("C is alone on Fridays");
  });

  it("ignores weak day habits (share below threshold)", () => {
    const weak = { index: 2, label: "Tuesday", share: 0.16 };
    const { timingTakeaway } = buildComparisonInsights([
      makeBrand("A", { typicalDay: weak }),
      makeBrand("B", { typicalDay: weak })
    ]);
    expect(timingTakeaway).toBeNull();
  });
});

describe("promo takeaway", () => {
  it("contrasts a heavy discounter with an abstainer", () => {
    const { promoTakeaway } = buildComparisonInsights([
      makeBrand("Pushy", { discountShare: 0.55 }),
      makeBrand("Premium", { discountShare: 0.02 })
    ]);
    expect(promoTakeaway).toContain("Pushy");
    expect(promoTakeaway).toContain("55%");
    expect(promoTakeaway).toContain("Premium almost never");
  });

  it("names every brand tied at the abstainer floor", () => {
    const { promoTakeaway } = buildComparisonInsights([
      makeBrand("Pushy", { discountShare: 0.55 }),
      makeBrand("Quiet", { discountShare: 0.0 }),
      makeBrand("Silent", { discountShare: 0.02 })
    ]);
    expect(promoTakeaway).toContain("Silent and Quiet almost never do");
  });

  it("reports a no-discount group", () => {
    const { promoTakeaway } = buildComparisonInsights([
      makeBrand("A", { discountShare: 0.05 }),
      makeBrand("B", { discountShare: 0.03 })
    ]);
    expect(promoTakeaway).toContain("rare across this group");
  });
});

describe("occasions", () => {
  // Black Friday 2025 = November 28 (4th Friday).
  const blackFridayRunup = [
    { subject: "Black Friday is coming", receivedAt: "2025-11-01T09:00:00Z" },
    { subject: "Black Friday: 30% off", receivedAt: "2025-11-20T09:00:00Z" }
  ];

  it("builds a matrix row when one brand shows a real run-up", () => {
    const { occasions } = buildComparisonInsights([
      makeBrand("Active", { seasonalSubjects: blackFridayRunup }),
      makeBrand("Silent")
    ]);
    const row = occasions.rows.find((r) => r.eventId === "black-friday");
    expect(row).toBeDefined();
    expect(row?.cells[0].count).toBe(2);
    expect(row?.cells[0].leadDays).toBe(27);
    expect(row?.cells[1].count).toBe(0);
  });

  it("calls out a sole activator in a 3-brand group", () => {
    const { occasions } = buildComparisonInsights([
      makeBrand("Active", { seasonalSubjects: blackFridayRunup }),
      makeBrand("Silent"),
      makeBrand("AlsoSilent")
    ]);
    expect(occasions.takeaway).toContain("Only Active activates Black Friday");
  });

  it("drops events nobody really runs", () => {
    const { occasions } = buildComparisonInsights([
      makeBrand("A", {
        seasonalSubjects: [
          { subject: "One stray halloween mention", receivedAt: "2025-10-20T09:00:00Z" }
        ]
      }),
      makeBrand("B")
    ]);
    expect(occasions.rows.find((r) => r.eventId === "halloween")).toBeUndefined();
  });
});

describe("voice takeaway", () => {
  it("contrasts subject length extremes", () => {
    const { voiceTakeaway, subjectLengthRange } = buildComparisonInsights([
      makeBrand("Wordy", { avgSubjectLength: 70 }),
      makeBrand("Terse", { avgSubjectLength: 30 })
    ]);
    expect(voiceTakeaway).toContain("Wordy");
    expect(voiceTakeaway).toContain("70");
    expect(subjectLengthRange).toEqual({ min: 30, max: 70 });
  });

  it("adds the emoji contrast when extreme", () => {
    const { voiceTakeaway } = buildComparisonInsights([
      makeBrand("Sparkly", { emojiShare: 0.8 }),
      makeBrand("Plain", { emojiShare: 0.05 })
    ]);
    expect(voiceTakeaway).toContain("Sparkly");
    expect(voiceTakeaway).toContain("80%");
    expect(voiceTakeaway).toContain("Plain stays plain");
  });

  it("stays silent when everyone writes alike", () => {
    const { voiceTakeaway } = buildComparisonInsights([
      makeBrand("A", { avgSubjectLength: 40, emojiShare: 0.3 }),
      makeBrand("B", { avgSubjectLength: 45, emojiShare: 0.35 })
    ]);
    expect(voiceTakeaway).toBeNull();
  });
});

describe("quiet zones", () => {
  // 2026-06-01 is a Monday; 07:00Z = 09:00 in Copenhagen (CEST) →
  // Monday morning.
  function mondayMorningSends(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      subject: `Newsletter ${i}`,
      receivedAt: "2026-06-01T07:00:00Z"
    }));
  }

  it("finds a fully empty day once volume is sufficient", () => {
    const { quietZones } = buildComparisonInsights([
      makeBrand("A", { seasonalSubjects: mondayMorningSends(25) }),
      makeBrand("B", { seasonalSubjects: mondayMorningSends(25) })
    ]);
    expect(quietZones.grid[0][0]).toBe(50);
    expect(quietZones.takeaway).toContain("Nobody in this group sends on Tuesdays");
  });

  it("stays silent below the volume threshold", () => {
    const { quietZones } = buildComparisonInsights([
      makeBrand("A", { seasonalSubjects: mondayMorningSends(5) }),
      makeBrand("B", { seasonalSubjects: mondayMorningSends(5) })
    ]);
    expect(quietZones.takeaway).toBeNull();
    expect(quietZones.totalSends).toBe(10);
    expect(quietZones.openings).toEqual([]);
    expect(quietZones.busiest).toBeNull();
  });

  it("ranks openings quietest-first and names the busiest slot", () => {
    // 50 sends all in Monday morning → that's the busiest cell, and the
    // quietest openings are empty slots (count 0), weekday-first.
    const { quietZones } = buildComparisonInsights([
      makeBrand("A", { seasonalSubjects: mondayMorningSends(25) }),
      makeBrand("B", { seasonalSubjects: mondayMorningSends(25) })
    ]);
    expect(quietZones.openings).toHaveLength(3);
    expect(quietZones.openings.every((slot) => slot.count === 0)).toBe(true);
    // Tie-break favours weekday + earlier daypart, so the very first
    // opening is a weekday morning (never Monday — that's the busy one).
    expect(quietZones.openings[0].label).toMatch(/morning$/);
    expect(quietZones.busiest?.label).toBe("Monday morning");
    expect(quietZones.busiest?.count).toBe(50);
    // Hover breakdown: both brands send in the busiest slot; open slots
    // have no senders.
    expect(quietZones.busiest?.senders.map((s) => s.name).sort()).toEqual([
      "A",
      "B"
    ]);
    expect(quietZones.openings[0].senders).toEqual([]);
  });

  it("only counts sends within ~3 months of the latest send", () => {
    // 50 recent Monday-morning sends plus 30 Wednesday-morning sends
    // from >3 months earlier; the stale ones must not reach the grid.
    const recent = mondayMorningSends(25);
    const stale = Array.from({ length: 15 }, (_, i) => ({
      subject: `Old ${i}`,
      // 2026-01-07 is a Wednesday, ~5 months before the recent batch.
      receivedAt: "2026-01-07T07:00:00Z"
    }));
    const { quietZones } = buildComparisonInsights([
      makeBrand("A", { seasonalSubjects: [...recent, ...stale] }),
      makeBrand("B", { seasonalSubjects: [...recent, ...stale] })
    ]);
    // Only the 50 recent sends counted; the 30 stale ones dropped.
    expect(quietZones.totalSends).toBe(50);
    expect(quietZones.grid[0][0]).toBe(50); // Monday morning
    expect(quietZones.grid[0][2]).toBe(0); // Wednesday morning — stale, excluded
  });
});

describe("urgency", () => {
  it("scores urgency phrases and contrasts the extremes in voice", () => {
    const pushy = makeBrand("Pushy", {
      seasonalSubjects: [
        { subject: "Last chance: 30% off", receivedAt: "2026-05-01T10:00:00Z" },
        { subject: "Hurry — ends tonight", receivedAt: "2026-05-08T10:00:00Z" },
        { subject: "New arrivals", receivedAt: "2026-05-15T10:00:00Z" },
        { subject: "Our spring picks", receivedAt: "2026-05-22T10:00:00Z" }
      ]
    });
    const calm = makeBrand("Calm", {
      seasonalSubjects: [
        { subject: "Notes from the studio", receivedAt: "2026-05-02T10:00:00Z" },
        { subject: "A look at the new collection", receivedAt: "2026-05-09T10:00:00Z" }
      ]
    });
    expect(urgencyShare(pushy)).toBeCloseTo(0.5, 5);
    expect(urgencyShare(calm)).toBe(0);

    const { voiceTakeaway, urgencyShares } = buildComparisonInsights([
      pushy,
      calm
    ]);
    expect(urgencyShares).toEqual([0.5, 0]);
    expect(voiceTakeaway).toContain("Pushy pushes urgency");
    expect(voiceTakeaway).toContain("Calm never does");
  });

  it("does not match urgency words inside other words", () => {
    const brand = makeBrand("A", {
      seasonalSubjects: [
        // "hurry" must not match "Hurrying" → word-boundary matcher.
        { subject: "Hurrying through autumn", receivedAt: "2026-05-01T10:00:00Z" }
      ]
    });
    expect(urgencyShare(brand)).toBe(0);
  });
});

describe("reminder detection", () => {
  it("chains near-identical subjects within the window into threads", () => {
    const brand = makeBrand("A", {
      seasonalSubjects: [
        { subject: "Summer sale ends soon", receivedAt: "2026-06-01T10:00:00Z" },
        { subject: "Reminder: summer sale ends soon", receivedAt: "2026-06-03T10:00:00Z" },
        { subject: "Meet the new linen shirts", receivedAt: "2026-06-05T10:00:00Z" },
        { subject: "Our stores are moving", receivedAt: "2026-06-08T10:00:00Z" }
      ]
    });
    const result = reminderShare(brand);
    expect(result.threads).toBe(3);
    expect(result.share).toBeCloseTo(1 / 3, 5);
  });

  it("does not chain similar subjects sent far apart", () => {
    const brand = makeBrand("A", {
      seasonalSubjects: [
        { subject: "Summer sale ends soon", receivedAt: "2026-06-01T10:00:00Z" },
        { subject: "Summer sale ends soon again", receivedAt: "2026-06-20T10:00:00Z" }
      ]
    });
    const result = reminderShare(brand);
    expect(result.threads).toBe(2);
    expect(result.share).toBe(0);
  });

  it("ignores non-campaign (welcome) emails", () => {
    const brand = makeBrand("A", {
      seasonalSubjects: [
        { subject: "Welcome to the club", receivedAt: "2026-06-01T10:00:00Z", category: "welcome" },
        { subject: "Welcome to the club", receivedAt: "2026-06-02T10:00:00Z", category: "welcome" }
      ]
    });
    expect(reminderShare(brand).threads).toBe(0);
  });
});

describe("discount trend", () => {
  // Two brands, both discounting 15% in Jan–Mar and 30% in Apr–Jun.
  function creepingBrand(name: string) {
    const months = ["01", "02", "03", "04", "05", "06"];
    return makeBrand(name, {
      seasonalSubjects: months.map((mm, i) => ({
        subject: `Sale ${mm}`,
        receivedAt: `2026-${mm}-15T10:00:00Z`,
        discountPercent: i < 3 ? 15 : 30
      }))
    });
  }

  it("builds aligned monthly averages per brand", () => {
    const { discountTrend } = buildComparisonInsights([
      creepingBrand("A"),
      creepingBrand("B")
    ]);
    expect(discountTrend.months).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06"
    ]);
    expect(discountTrend.rows[0].points).toEqual([15, 15, 15, 30, 30, 30]);
  });

  it("reports discount creep as the promo takeaway", () => {
    const { promoTakeaway } = buildComparisonInsights([
      creepingBrand("A"),
      creepingBrand("B")
    ]);
    expect(promoTakeaway).toContain("climbed from ~15% to ~30%");
  });
});

describe("content mix takeaway", () => {
  it("contrasts a skewed mix against a different leader", () => {
    const { mix } = buildComparisonInsights([
      makeBrand("Discounter", {
        categories: [
          { id: "sale", label: "Sale", count: 80 },
          { id: "content", label: "Content", count: 20 }
        ]
      }),
      makeBrand("Editorial", {
        categories: [
          { id: "content", label: "Content", count: 60 },
          { id: "sale", label: "Sale", count: 40 }
        ]
      })
    ]);
    expect(mix.takeaway).toContain("Discounter is 80% sale emails");
    expect(mix.takeaway).toContain("Editorial leads with content");
  });

  it("notes a shared dominant category", () => {
    const { mix } = buildComparisonInsights([
      makeBrand("A", {
        categories: [{ id: "sale", label: "Sale", count: 55 }, { id: "content", label: "Content", count: 45 }]
      }),
      makeBrand("B", {
        categories: [{ id: "sale", label: "Sale", count: 52 }, { id: "content", label: "Content", count: 48 }]
      })
    ]);
    expect(mix.takeaway).toContain("Every brand's mix leads with sale emails");
  });

  it("folds categories past the top six into Other", () => {
    const { mix } = buildComparisonInsights([
      makeBrand("A", {
        categories: [
          { id: "sale", label: "Sale", count: 40 },
          { id: "content", label: "Content", count: 30 },
          { id: "event", label: "Event", count: 20 },
          { id: "products", label: "Products", count: 15 },
          { id: "loyalty", label: "Loyalty", count: 10 },
          { id: "welcome", label: "Welcome", count: 8 },
          { id: "survey", label: "Survey", count: 5 },
          { id: "education", label: "Education", count: 2 }
        ]
      })
    ]);
    const segments = mix.rows[0].segments;
    // 6 named categories + Other (survey + education folded in).
    expect(segments.length).toBe(7);
    expect(segments[segments.length - 1].id).toBe("other");
    expect(segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 5);
  });

  it("orders categories the same way in every bar (group volume)", () => {
    const { mix } = buildComparisonInsights([
      makeBrand("A", {
        categories: [
          { id: "sale", label: "Sale", count: 50 },
          { id: "products", label: "Products", count: 30 },
          { id: "event", label: "Event", count: 20 }
        ]
      }),
      makeBrand("B", {
        categories: [
          { id: "products", label: "Products", count: 60 },
          { id: "sale", label: "Sale", count: 20 },
          { id: "event", label: "Event", count: 20 }
        ]
      })
    ]);
    // Group totals: products 90 > sale 70 > event 40.
    const expected = ["products", "sale", "event"];
    expect(mix.legend.map((l) => l.id)).toEqual(expected);
    // Both bars follow the shared order, not their own dominant.
    expect(mix.rows[0].segments.map((s) => s.id)).toEqual(expected);
    expect(mix.rows[1].segments.map((s) => s.id)).toEqual(expected);
  });
});
