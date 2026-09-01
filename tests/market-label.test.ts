import { describe, expect, it } from "vitest";
import { formatMarketLabel } from "@/lib/market-label";

/**
 * `formatMarketLabel` was extracted from two private copies (brand-db and
 * the compare picker) when the onboarding modal became a third consumer —
 * this pins the shared behavior so the extraction stays faithful.
 */
describe("formatMarketLabel", () => {
  it("title-cases underscore, dash and space separated slugs", () => {
    expect(formatMarketLabel("home_design")).toBe("Home Design");
    expect(formatMarketLabel("baby-kids")).toBe("Baby Kids");
    expect(formatMarketLabel("outdoor gear")).toBe("Outdoor Gear");
  });

  it("handles single-word and already-cased input", () => {
    expect(formatMarketLabel("fashion")).toBe("Fashion");
    expect(formatMarketLabel("Fashion")).toBe("Fashion");
  });

  it("trims surrounding whitespace and keeps empty input unchanged", () => {
    expect(formatMarketLabel("  fashion  ")).toBe("Fashion");
    expect(formatMarketLabel("")).toBe("");
    expect(formatMarketLabel("   ")).toBe("   ");
  });
});
