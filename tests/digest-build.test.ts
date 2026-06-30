import { describe, expect, it } from "vitest";
import { buildDigestModel } from "@/lib/digest/build";
import type { BrandPageData } from "@/lib/brand-db";

/**
 * The digest builder reads brand identity, the daily timeline + cadence
 * average (for the headline signals it shares with the Comparisons feed)
 * and the seasonal sample (windowed for counts, picks and the tail). The
 * factory fills exactly those and casts.
 */

const NOW = new Date("2026-06-12T00:00:00Z");
const WINDOW_START = new Date(NOW.getTime() - 7 * 86_400_000); // weekly
const ANCHOR_UTC = NOW.getTime();

type SampleEmail = {
  id: string;
  subject: string;
  receivedAt: string;
  category: string;
  discountPercent?: number | null;
};

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
  opts: {
    emails?: SampleEmail[]; // newest-first, mirroring real seasonalSample
    counts?: number[];
    avgDaysBetween?: number | null;
    emailCount?: number;
  } = {}
): BrandPageData {
  return {
    brand: { id: `id-${name}`, name },
    totals: {
      emailCount: opts.emailCount ?? 50,
      sampleSize: 50,
      firstEmailAt: "2024-01-01T00:00:00Z",
      lastEmailAt: NOW.toISOString()
    },
    cadence: {
      avgDaysBetween:
        opts.avgDaysBetween !== undefined ? opts.avgDaysBetween : 7,
      dailyTimeline: timeline(opts.counts ?? [])
    },
    seasonalSample: (opts.emails ?? []).map((e) => ({
      id: e.id,
      subject: e.subject,
      preheader: null,
      receivedAt: e.receivedAt,
      category: e.category,
      hasGif: false,
      hasDarkMode: false,
      discountPercent: e.discountPercent ?? null,
      promoCode: null
    }))
  } as unknown as BrandPageData;
}

function build(brands: BrandPageData[]) {
  return buildDigestModel({
    cadence: "weekly",
    windowStart: WINDOW_START,
    windowEnd: NOW,
    brands
  });
}

describe("digest counts and window", () => {
  it("counts only emails inside the window", () => {
    const model = build([
      makeBrand("Acme", {
        emails: [
          { id: "1", subject: "In window", receivedAt: "2026-06-10T10:00:00Z", category: "content" },
          { id: "2", subject: "Also in", receivedAt: "2026-06-07T10:00:00Z", category: "content" },
          { id: "3", subject: "Too old", receivedAt: "2026-05-01T10:00:00Z", category: "content" }
        ]
      })
    ]);
    expect(model.emailCount).toBe(2);
    expect(model.brandCount).toBe(1);
  });

  it("reports an empty window as zero (the job suppresses it)", () => {
    const model = build([
      makeBrand("Quiet", {
        emails: [
          { id: "1", subject: "Old", receivedAt: "2026-01-01T10:00:00Z", category: "sale" }
        ]
      })
    ]);
    expect(model.emailCount).toBe(0);
    expect(model.brandCount).toBe(0);
  });
});

describe("worth a look picks", () => {
  it("ranks a product launch above plain content and excludes welcome", () => {
    const model = build([
      makeBrand("Brandy", {
        emails: [
          { id: "w", subject: "Welcome aboard", receivedAt: "2026-06-11T10:00:00Z", category: "welcome" },
          { id: "c", subject: "Weekly reads", receivedAt: "2026-06-10T10:00:00Z", category: "content" },
          { id: "l", subject: "New shoe just dropped", receivedAt: "2026-06-09T10:00:00Z", category: "product_launch" }
        ]
      })
    ]);
    expect(model.picks[0].subject).toBe("New shoe just dropped");
    expect(model.picks[0].kind).toBe("launch");
    // welcome is never surfaced
    expect(model.picks.some((p) => p.subject === "Welcome aboard")).toBe(false);
  });

  it("caps picks at two and routes other brands to the tail", () => {
    const model = build([
      makeBrand("Nike", {
        emails: [
          { id: "a", subject: "Launch A", receivedAt: "2026-06-11T10:00:00Z", category: "product_launch" }
        ]
      }),
      makeBrand("Adidas", {
        emails: [
          { id: "c", subject: "Launch C", receivedAt: "2026-06-09T10:00:00Z", category: "product_launch" }
        ]
      }),
      makeBrand("Puma", {
        emails: [
          { id: "d", subject: "Weekly reads", receivedAt: "2026-06-08T10:00:00Z", category: "content" }
        ]
      })
    ]);
    expect(model.picks).toHaveLength(2);
    // Puma's low-value content didn't make the cut, so it shows up in the tail.
    expect(model.tail.map((t) => t.brandName)).toContain("Puma");
  });

  it("never gives one brand more than one pick", () => {
    const model = build([
      makeBrand("Rosendahl", {
        emails: [
          { id: "x", subject: "Spar op til 70%", receivedAt: "2026-06-10T10:00:00Z", category: "sale", discountPercent: 70 },
          { id: "y", subject: "SPAR OP TIL 70%", receivedAt: "2026-06-09T10:00:00Z", category: "sale", discountPercent: 70 }
        ]
      })
    ]);
    // One brand, two strong sends → still only a single pick.
    expect(model.picks).toHaveLength(1);
    expect(model.picks[0].brandName).toBe("Rosendahl");
  });

  it("dates a launch against the brand's own history", () => {
    const model = build([
      makeBrand("Cadence", {
        emails: [
          { id: "new", subject: "Fresh drop", receivedAt: "2026-06-10T10:00:00Z", category: "product_launch" },
          { id: "old", subject: "Prior drop", receivedAt: "2026-05-08T10:00:00Z", category: "product_launch" }
        ]
      })
    ]);
    // ~33 days back → ~5 weeks.
    expect(model.picks[0].why).toMatch(/First product launch in \d+ weeks\./);
  });

  it("frames a discount after a long dry spell", () => {
    const model = build([
      makeBrand("Ganni", {
        emails: [
          { id: "fresh", subject: "Seasonal sale", receivedAt: "2026-06-09T10:00:00Z", category: "sale", discountPercent: 40 },
          { id: "stale", subject: "Old sale", receivedAt: "2026-02-08T10:00:00Z", category: "sale", discountPercent: 20 }
        ]
      })
    ]);
    expect(model.picks[0].why).toMatch(/First discount in about \d+ months\./);
  });
});

describe("headline", () => {
  it("falls back to plain stats when nothing is notable", () => {
    const model = build([
      makeBrand("Steady", {
        emails: [
          { id: "1", subject: "Note", receivedAt: "2026-06-10T10:00:00Z", category: "content" }
        ]
      })
    ]);
    expect(model.nothingUnusual).toBe(true);
    expect(model.headline).toEqual([]);
  });

  it("synthesizes a headline from a pace spike", () => {
    const spikeCounts = [
      ...Array.from({ length: 84 }, (_, i) => (i % 7 === 0 ? 1 : 0)),
      2, 2, 2, 2, 2, 2, 0
    ];
    const model = build([
      makeBrand("Loud", {
        counts: spikeCounts,
        emails: [
          { id: "x", subject: "Buy now", receivedAt: "2026-06-10T10:00:00Z", category: "sale", discountPercent: 10 }
        ]
      })
    ]);
    expect(model.nothingUnusual).toBe(false);
    expect(model.headline[0]).toContain("Loud sent");
  });
});
