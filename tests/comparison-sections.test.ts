import { describe, expect, it } from "vitest";
import {
  COMPARE_SECTIONS,
  defaultCompareSectionPrefs,
  sanitizeCompareSectionPrefs
} from "@/lib/comparison-sections";

const ALL_IDS = COMPARE_SECTIONS.map((s) => s.id);

describe("sanitizeCompareSectionPrefs", () => {
  it("returns defaults for garbage input", () => {
    for (const input of [null, undefined, 42, "x", [], {}]) {
      expect(sanitizeCompareSectionPrefs(input)).toEqual(
        defaultCompareSectionPrefs()
      );
    }
  });

  it("preserves a valid saved order and hidden list", () => {
    const reversed = [...ALL_IDS].reverse();
    const prefs = sanitizeCompareSectionPrefs({
      order: reversed,
      hidden: ["promo", "recent"]
    });
    expect(prefs.order).toEqual(reversed);
    expect(prefs.hidden).toEqual(["promo", "recent"]);
  });

  it("drops unknown ids and duplicates", () => {
    const prefs = sanitizeCompareSectionPrefs({
      order: ["promo", "bogus", "promo", ...ALL_IDS],
      hidden: ["bogus", "kpis", "kpis"]
    });
    expect(prefs.order.filter((id) => id === "promo")).toHaveLength(1);
    expect(prefs.order).not.toContain("bogus");
    expect(prefs.order).toHaveLength(ALL_IDS.length);
    expect(prefs.hidden).toEqual(["kpis"]);
  });

  it("inserts sections missing from a stale order at their default position", () => {
    // Saved before "occasions" existed: a stale order without it.
    const stale = ALL_IDS.filter((id) => id !== "occasions");
    const prefs = sanitizeCompareSectionPrefs({ order: stale, hidden: [] });
    expect(prefs.order).toContain("occasions");
    // Default position: right after "promo".
    expect(prefs.order.indexOf("occasions")).toBe(
      prefs.order.indexOf("promo") + 1
    );
  });

  it("always returns the complete section set, even for partial payloads", () => {
    // Real clients always PUT the full order; a sparse payload is just
    // backfilled with defaults — completeness is the guarantee, not
    // preserving the sparse payload's relative placement.
    const prefs = sanitizeCompareSectionPrefs({
      order: ["recent"],
      hidden: []
    });
    expect([...prefs.order].sort()).toEqual([...ALL_IDS].sort());
  });
});
