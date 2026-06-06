import { describe, expect, it } from "vitest";
import { rollupCountries } from "@/lib/market-detect";

const NOW = Date.parse("2026-06-06T00:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("rollupCountries", () => {
  it("returns unknown when there are no country-bearing emails", () => {
    expect(rollupCountries([], NOW)).toEqual({
      country: null,
      confidence: null,
      emailsConsidered: 0
    });
  });

  it("picks the dominant country and reports its share as confidence", () => {
    const rows = Array.from({ length: 8 }, () => ({
      detected_country: "DK",
      country_confidence: 0.9,
      received_at: daysAgo(10)
    }));
    rows.push({ detected_country: "US", country_confidence: 0.9, received_at: daysAgo(10) });

    const result = rollupCountries(rows, NOW);
    expect(result.country).toBe("DK");
    expect(result.emailsConsidered).toBe(9);
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it("stays unknown when no country clears the dominance threshold", () => {
    const rows = [
      { detected_country: "DK", country_confidence: 0.9, received_at: daysAgo(10) },
      { detected_country: "SE", country_confidence: 0.9, received_at: daysAgo(10) },
      { detected_country: "DE", country_confidence: 0.9, received_at: daysAgo(10) }
    ];
    expect(rollupCountries(rows, NOW).country).toBeNull();
  });

  it("lets fresh mail outweigh stale mail from an old market via recency decay", () => {
    const rows = [
      // Brand pivoted: lots of old US mail, recent run of Danish mail.
      ...Array.from({ length: 6 }, () => ({
        detected_country: "US",
        country_confidence: 0.9,
        received_at: daysAgo(900)
      })),
      ...Array.from({ length: 5 }, () => ({
        detected_country: "DK",
        country_confidence: 0.9,
        received_at: daysAgo(5)
      }))
    ];
    expect(rollupCountries(rows, NOW).country).toBe("DK");
  });

  it("weights by per-email confidence", () => {
    const rows = [
      { detected_country: "US", country_confidence: 0.2, received_at: daysAgo(5) },
      { detected_country: "US", country_confidence: 0.2, received_at: daysAgo(5) },
      { detected_country: "DK", country_confidence: 0.95, received_at: daysAgo(5) }
    ];
    expect(rollupCountries(rows, NOW).country).toBe("DK");
  });
});
