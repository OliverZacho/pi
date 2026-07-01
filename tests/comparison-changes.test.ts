import { describe, expect, it } from "vitest";
import {
  detectBrandChanges,
  detectGroupChanges
} from "@/lib/comparison-changes";
import type { BrandPageData } from "@/lib/brand-db";

/**
 * Change detectors only read brand identity, totals, the daily
 * timeline, the cadence average and the seasonal sample — the factory
 * fills exactly those and casts, keeping fixtures focused on the
 * behaviour under test.
 */

const ANCHOR_UTC = Date.UTC(2026, 5, 12); // 2026-06-12, timeline's last day

/** Builds a daily timeline ending on the anchor; counts oldest-first. */
function timeline(counts: number[]): { date: string; count: number }[] {
  return counts.map((count, i) => ({
    date: new Date(ANCHOR_UTC - (counts.length - 1 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10),
    count
  }));
}

function makeBrand(
  name: string,
  overrides: {
    counts?: number[];
    avgDaysBetween?: number | null;
    emailCount?: number;
    discounts?: { receivedAt: string; percent: number }[];
    sampleDates?: string[];
  } = {}
): BrandPageData {
  const counts = overrides.counts ?? [];
  const discountEmails = (overrides.discounts ?? []).map((d, i) => ({
    id: `d-${i}`,
    subject: `Sale ${i}`,
    preheader: null,
    receivedAt: d.receivedAt,
    category: "sale",
    hasGif: false,
    hasDarkMode: false,
    discountPercent: d.percent,
    promoCode: null
  }));
  const plainEmails = (overrides.sampleDates ?? []).map((receivedAt, i) => ({
    id: `p-${i}`,
    subject: `Newsletter ${i}`,
    preheader: null,
    receivedAt,
    category: "content",
    hasGif: false,
    hasDarkMode: false,
    discountPercent: null,
    promoCode: null
  }));

  return {
    brand: { id: `id-${name}`, name },
    totals: {
      emailCount: overrides.emailCount ?? 50,
      sampleSize: 50,
      firstEmailAt: "2024-01-01T00:00:00Z",
      lastEmailAt: "2026-06-10T00:00:00Z"
    },
    cadence: {
      avgDaysBetween:
        overrides.avgDaysBetween !== undefined ? overrides.avgDaysBetween : 7,
      dailyTimeline: timeline(counts)
    },
    seasonalSample: [...discountEmails, ...plainEmails]
  } as unknown as BrandPageData;
}

describe("pace spike", () => {
  it("flags a week far above the brand's own baseline", () => {
    // 12 weeks at 1/week, then 6 sends in the final 7 days.
    const counts = [
      ...Array.from({ length: 84 }, (_, i) => (i % 7 === 0 ? 1 : 0)),
      1, 1, 1, 1, 1, 1, 0
    ];
    const changes = detectBrandChanges(makeBrand("Loud", { counts }), 0);
    const spike = changes.find((c) => c.kind === "pace_spike");
    expect(spike).toBeDefined();
    expect(spike?.message).toContain("Loud sent 6 emails");
    expect(spike?.message).toContain("6× their usual pace");
  });

  it("does not spike on pre-capture zeros for a recently-added brand", () => {
    // The brand was only captured ~5 weeks ago: ~56 leading zero-days
    // (before tracking began), then a steady ~8/week, including 8 in the
    // final 7 days. Counting the phantom zeros would read as a ~4× spike;
    // against the brand's real history it's flat, so no claim.
    const counts = [
      ...new Array(56).fill(0),
      ...Array.from({ length: 28 }, () => 8 / 7), // ~8/week, real history
      8, 0, 0, 0, 0, 0, 0
    ].map((c) => Math.round(c));
    const changes = detectBrandChanges(makeBrand("Newcomer", { counts }), 0);
    expect(changes.find((c) => c.kind === "pace_spike")).toBeUndefined();
  });

  it("still suppresses a brand with too little captured history", () => {
    // Only ~3 weeks of real sends behind the recent week — not enough
    // baseline to claim a spike, even though the recent week is busy.
    const counts = [
      ...new Array(70).fill(0),
      ...Array.from({ length: 14 }, (_, i) => (i % 7 === 0 ? 1 : 0)),
      4, 1, 1, 1, 0, 0, 0
    ];
    const changes = detectBrandChanges(makeBrand("Fresh", { counts }), 0);
    expect(changes.find((c) => c.kind === "pace_spike")).toBeUndefined();
  });

  it("ignores low-volume blips", () => {
    // Baseline ~1/week but only 2 recent sends — 2× ratio, no volume.
    const counts = [
      ...Array.from({ length: 84 }, (_, i) => (i % 7 === 0 ? 1 : 0)),
      1, 0, 0, 1, 0, 0, 0
    ];
    const changes = detectBrandChanges(makeBrand("A", { counts }), 0);
    expect(changes.find((c) => c.kind === "pace_spike")).toBeUndefined();
  });
});

describe("gone quiet", () => {
  it("flags an unusual silence from a regular sender", () => {
    // Sends every 3rd day, last one on day 42 of 45 — so the trailing
    // silence is 2 pattern days + 15 explicit zeros = 17 days.
    const counts = [
      ...Array.from({ length: 45 }, (_, i) => (i % 3 === 0 ? 1 : 0)),
      ...new Array(15).fill(0)
    ];
    const changes = detectBrandChanges(
      makeBrand("Sleepy", { counts, avgDaysBetween: 3 }),
      0
    );
    const quiet = changes.find((c) => c.kind === "gone_quiet");
    expect(quiet).toBeDefined();
    expect(quiet?.message).toContain("17 days without a send");
  });

  it("never calls an infrequent sender quiet", () => {
    const counts = [
      ...Array.from({ length: 45 }, (_, i) => (i % 30 === 0 ? 1 : 0)),
      ...new Array(15).fill(0)
    ];
    const changes = detectBrandChanges(
      makeBrand("Monthly", { counts, avgDaysBetween: 30 }),
      0
    );
    expect(changes.find((c) => c.kind === "gone_quiet")).toBeUndefined();
  });
});

describe("first sale in a while", () => {
  it("flags a fresh discount after a long dry spell", () => {
    const changes = detectBrandChanges(
      makeBrand("Premium", {
        counts: new Array(40).fill(0),
        avgDaysBetween: null,
        discounts: [
          { receivedAt: "2026-06-10T10:00:00Z", percent: 25 },
          { receivedAt: "2026-02-01T10:00:00Z", percent: 20 }
        ]
      }),
      0
    );
    const sale = changes.find((c) => c.kind === "first_sale");
    expect(sale).toBeDefined();
    expect(sale?.message).toContain("first discount in about 4 months");
    expect(sale?.message).toContain("25% off");
  });

  it("stays silent when the sample can't prove a dry spell", () => {
    // Single discount, sample only reaches back 20 days — no way to
    // know whether this is "first in months".
    const changes = detectBrandChanges(
      makeBrand("New", {
        counts: new Array(40).fill(0),
        avgDaysBetween: null,
        discounts: [{ receivedAt: "2026-06-10T10:00:00Z", percent: 25 }],
        sampleDates: ["2026-05-23T10:00:00Z"]
      }),
      0
    );
    expect(changes.find((c) => c.kind === "first_sale")).toBeUndefined();
  });
});

describe("detectGroupChanges", () => {
  it("returns nothing for a steady group", () => {
    const counts = Array.from({ length: 91 }, (_, i) => (i % 7 === 0 ? 1 : 0));
    const changes = detectGroupChanges([
      makeBrand("A", { counts }),
      makeBrand("B", { counts })
    ]);
    expect(changes).toEqual([]);
  });

  it("merges and sorts changes across brands", () => {
    const spikeCounts = [
      ...Array.from({ length: 84 }, (_, i) => (i % 7 === 0 ? 1 : 0)),
      2, 2, 2, 2, 2, 2, 0 // 12× baseline
    ];
    const quietCounts = [
      ...Array.from({ length: 45 }, (_, i) => (i % 3 === 0 ? 1 : 0)),
      ...new Array(15).fill(0) // 5× typical gap
    ];
    const changes = detectGroupChanges([
      makeBrand("Quiet", { counts: quietCounts, avgDaysBetween: 3 }),
      makeBrand("Spiky", { counts: spikeCounts })
    ]);
    expect(changes).toHaveLength(2);
    expect(changes[0].brandName).toBe("Spiky");
    expect(changes[0].kind).toBe("pace_spike");
    expect(changes[1].kind).toBe("gone_quiet");
  });
});
