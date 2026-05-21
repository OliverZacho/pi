import { describe, expect, it } from "vitest";
import {
  dedupeBrandIds,
  MAX_BRANDS_PER_COMPARISON
} from "@/lib/competitor-db";

/**
 * `dedupeBrandIds` is the pure-function gate the API layer + the
 * landing client share to validate brand-id arrays before they reach
 * the database. The behaviour matters because it's the only thing
 * stopping an upstream typo / SQL-injection probe from reaching
 * PostgREST as a malformed `in.(...)` query.
 */
describe("dedupeBrandIds", () => {
  it("drops empty input", () => {
    expect(dedupeBrandIds([])).toEqual([]);
  });

  it("preserves order while removing duplicates", () => {
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    const c = "33333333-3333-4333-8333-333333333333";
    expect(dedupeBrandIds([a, b, a, c, b])).toEqual([a, b, c]);
  });

  it("rejects non-UUID strings", () => {
    expect(
      dedupeBrandIds([
        "11111111-1111-4111-8111-111111111111",
        "not-a-uuid",
        "",
        "<script>",
        "11111111111111111111111111111111"
      ])
    ).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });

  it("trims whitespace before validating", () => {
    expect(
      dedupeBrandIds([
        "  11111111-1111-4111-8111-111111111111  "
      ])
    ).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });

  it("ignores non-string entries that slip through TS narrowing", () => {
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dedupeBrandIds([null as any, undefined as any, 42 as any])
    ).toEqual([]);
  });
});

describe("MAX_BRANDS_PER_COMPARISON", () => {
  it("is wide enough to support a category-wide cohort", () => {
    // Locked at 20: the aggregate views (stacked send-frequency bars,
    // KPI tiles with drill-down) absorb the extra brands while keeping
    // the heatmap and legend readable.
    expect(MAX_BRANDS_PER_COMPARISON).toBe(20);
  });
});
