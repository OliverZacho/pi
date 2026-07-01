import { describe, expect, it } from "vitest";
import {
  detectUnusualSignals,
  buildUnusualModel
} from "@/lib/notifications/unusual-build";
import { renderUnusualEmail } from "@/lib/notifications/unusual-render";
import type { BrandPageData } from "@/lib/brand-db";

/**
 * Reuses the comparison-changes fixture shape: detectors read brand
 * identity, totals, the daily timeline, the cadence average and the
 * seasonal sample. The factory fills exactly those and casts.
 */

const ANCHOR_UTC = Date.UTC(2026, 5, 12);

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
  } = {}
): BrandPageData {
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
      dailyTimeline: timeline(overrides.counts ?? [])
    },
    seasonalSample: discountEmails
  } as unknown as BrandPageData;
}

const spikeBrand = () =>
  makeBrand("Loud", {
    counts: [
      ...Array.from({ length: 84 }, (_, i) => (i % 7 === 0 ? 1 : 0)),
      2, 2, 2, 2, 2, 2, 0
    ]
  });

const quietBrand = () =>
  makeBrand("Sleepy", {
    counts: [
      ...Array.from({ length: 45 }, (_, i) => (i % 3 === 0 ? 1 : 0)),
      ...new Array(15).fill(0)
    ],
    avgDaysBetween: 3
  });

const firstSaleBrand = () =>
  makeBrand("Discounter", {
    counts: new Array(40).fill(0),
    avgDaysBetween: null,
    discounts: [
      { receivedAt: "2026-06-10T10:00:00Z", percent: 25 },
      { receivedAt: "2026-02-01T10:00:00Z", percent: 20 }
    ]
  });

describe("detectUnusualSignals", () => {
  it("keeps pace spikes and gone-quiet, drops first_sale", () => {
    const signals = detectUnusualSignals([
      spikeBrand(),
      quietBrand(),
      firstSaleBrand()
    ]);
    const kinds = signals.map((s) => s.kind).sort();
    expect(kinds).toEqual(["gone_quiet", "pace_spike"]);
    // The discount brand only produced a first_sale change, so it's absent.
    expect(signals.some((s) => s.brandName === "Discounter")).toBe(false);
  });

  it("returns nothing for steady brands", () => {
    const steady = makeBrand("Steady", {
      counts: Array.from({ length: 91 }, (_, i) => (i % 7 === 0 ? 1 : 0))
    });
    expect(detectUnusualSignals([steady])).toEqual([]);
  });
});

describe("buildUnusualModel", () => {
  it("splits signals into ramping and quiet with a distinct brand count", () => {
    const signals = detectUnusualSignals([spikeBrand(), quietBrand()]);
    const model = buildUnusualModel("daily", signals);
    expect(model.ramping).toHaveLength(1);
    expect(model.quiet).toHaveLength(1);
    expect(model.brandCount).toBe(2);
  });
});

describe("renderUnusualEmail", () => {
  it("names the brand in the subject when a single signal fires", () => {
    const model = buildUnusualModel("daily", detectUnusualSignals([spikeBrand()]));
    const { subject, html } = renderUnusualEmail(model);
    expect(subject).toBe("Loud ramped up its sending");
    expect(html).toContain("RAMPING UP");
    expect(html).not.toContain("—");
  });

  it("summarizes across brands when several fire", () => {
    const model = buildUnusualModel(
      "weekly",
      detectUnusualSignals([spikeBrand(), quietBrand()])
    );
    expect(renderUnusualEmail(model).subject).toBe(
      "Unusual activity across 2 brands"
    );
  });
});
