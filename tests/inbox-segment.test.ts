import { describe, expect, it } from "vitest";
import { normalizeInboxSegment } from "@/lib/admin-db";

describe("normalizeInboxSegment", () => {
  it("returns an empty patch when nothing is supplied", () => {
    expect(normalizeInboxSegment(undefined)).toEqual({});
    expect(normalizeInboxSegment({})).toEqual({});
  });

  it("only includes keys that are present (partial PATCH semantics)", () => {
    expect(normalizeInboxSegment({ segmentLabel: "Jewellery" })).toEqual({
      segment_label: "Jewellery"
    });
  });

  it("lower-cases the category to match the markets vocabulary", () => {
    expect(normalizeInboxSegment({ segmentCategory: "Jewellery" })).toEqual({
      segment_category: "jewellery"
    });
  });

  it("upper-cases a valid ISO alpha-2 country and rejects anything else", () => {
    expect(normalizeInboxSegment({ segmentCountry: "us" })).toEqual({
      segment_country: "US"
    });
    // Not a 2-letter code → cleared to null rather than stored invalid.
    expect(normalizeInboxSegment({ segmentCountry: "USA" })).toEqual({
      segment_country: null
    });
    expect(normalizeInboxSegment({ segmentCountry: "1" })).toEqual({
      segment_country: null
    });
  });

  it("treats blank/whitespace values as an explicit clear (null)", () => {
    expect(
      normalizeInboxSegment({
        segmentLabel: "   ",
        segmentCategory: "",
        segmentCountry: ""
      })
    ).toEqual({
      segment_label: null,
      segment_category: null,
      segment_country: null
    });
  });

  it("trims surrounding whitespace on label and category", () => {
    expect(
      normalizeInboxSegment({ segmentLabel: "  Spring  ", segmentCategory: "  Furniture " })
    ).toEqual({
      segment_label: "Spring",
      segment_category: "furniture"
    });
  });
});
