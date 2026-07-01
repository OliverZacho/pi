import { describe, expect, it } from "vitest";
import {
  detectSeasonalSignals,
  buildSeasonalModel
} from "@/lib/notifications/seasonal-build";
import { renderSeasonalEmail } from "@/lib/notifications/seasonal-render";
import type { BrandPageData } from "@/lib/brand-db";

/**
 * Detection depends on "now" (which event is upcoming), so every case
 * pins a fixed clock. NOW sits ~26 days before Black Friday 2026
 * (4th Friday of November = 27 Nov) and ~53 before Christmas, while the
 * next Easter is >120 days out.
 */
const NOW = new Date("2026-11-01T00:00:00Z");

function makeBrand(
  name: string,
  emails: { subject: string; receivedAt: string; preheader?: string }[]
): BrandPageData {
  return {
    brand: { id: `id-${name}`, name },
    seasonalSample: emails.map((e, i) => ({
      id: `${name}-${i}`,
      subject: e.subject,
      preheader: e.preheader ?? null,
      receivedAt: e.receivedAt,
      category: "seasonal",
      hasGif: false,
      hasDarkMode: false,
      discountPercent: null,
      promoCode: null
    }))
  } as unknown as BrandPageData;
}

describe("detectSeasonalSignals", () => {
  it("flags a brand that has started teasing an upcoming event", () => {
    const brand = makeBrand("Muuto", [
      { subject: "Black Friday is coming", receivedAt: "2026-10-28T10:00:00Z" }
    ]);
    const signals = detectSeasonalSignals([brand], NOW);
    expect(signals).toHaveLength(1);
    expect(signals[0].eventLabel).toBe("Black Friday");
    expect(signals[0].eventYear).toBe(2026);
    expect(signals[0].message).toContain("has started its Black Friday run-up");
    expect(signals[0].fingerprint).toMatch(/^seasonal:.+:2026$/);
  });

  it("ignores brands with no seasonal mention", () => {
    const brand = makeBrand("Quiet", [
      { subject: "New arrivals this week", receivedAt: "2026-10-28T10:00:00Z" }
    ]);
    expect(detectSeasonalSignals([brand], NOW)).toEqual([]);
  });

  it("does not fire for an event still beyond the run-up window", () => {
    // Easter 2027 is >120 days after 1 Nov 2026, so an Easter tease now
    // is too early to count as a run-up.
    const brand = makeBrand("Early", [
      { subject: "Easter sale preview", receivedAt: "2026-10-30T10:00:00Z" }
    ]);
    const signals = detectSeasonalSignals([brand], NOW);
    expect(signals.some((s) => s.eventLabel.includes("Easter"))).toBe(false);
  });
});

describe("renderSeasonalEmail", () => {
  it("names the brand and event in the subject for a single signal", () => {
    const brand = makeBrand("Muuto", [
      { subject: "Black Friday is coming", receivedAt: "2026-10-28T10:00:00Z" }
    ]);
    const model = buildSeasonalModel("weekly", detectSeasonalSignals([brand], NOW));
    const { subject, html } = renderSeasonalEmail(model);
    expect(subject).toBe("Muuto is gearing up for Black Friday");
    expect(html).not.toContain("—");
  });
});
