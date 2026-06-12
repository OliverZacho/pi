import { describe, expect, it } from "vitest";
import { buildComparisonInsights, weeklySendRate } from "@/lib/comparison-insights";
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
    typicalDay?: { index: number; label: string; share: number } | null;
    discountShare?: number;
    avgDiscount?: number | null;
    avgSubjectLength?: number | null;
    emojiShare?: number;
    categories?: { id: string; label: string; count: number }[];
    seasonalSubjects?: { subject: string; receivedAt: string }[];
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
      dailyTimeline: timeline(overrides.perWeek ?? 3)
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
    calendar: { start: "2026-01-01", end: "2026-06-01", days: [] },
    recentEmails: [],
    seasonalSample: (overrides.seasonalSubjects ?? []).map((email, i) => ({
      id: `email-${name}-${i}`,
      subject: email.subject,
      preheader: null,
      receivedAt: email.receivedAt,
      category: "seasonal",
      hasGif: false,
      hasDarkMode: false,
      discountPercent: null,
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

  it("collapses small categories into Other", () => {
    const { mix } = buildComparisonInsights([
      makeBrand("A", {
        categories: [
          { id: "sale", label: "Sale", count: 40 },
          { id: "content", label: "Content", count: 30 },
          { id: "event", label: "Event", count: 10 },
          { id: "loyalty", label: "Loyalty", count: 8 },
          { id: "welcome", label: "Welcome", count: 7 },
          { id: "survey", label: "Survey", count: 5 }
        ]
      })
    ]);
    const segments = mix.rows[0].segments;
    expect(segments.length).toBe(5);
    expect(segments[segments.length - 1].id).toBe("other");
    expect(
      segments.reduce((sum, s) => sum + s.share, 0)
    ).toBeCloseTo(1, 5);
  });
});
