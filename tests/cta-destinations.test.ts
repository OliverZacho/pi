import { describe, expect, it } from "vitest";
import { classifyCtaDestination } from "@/lib/cta-destinations";

describe("classifyCtaDestination", () => {
  it("classifies common e-commerce paths", () => {
    expect(
      classifyCtaDestination("https://shop.example.com/products/linen-shirt")
    ).toBe("product");
    expect(
      classifyCtaDestination("https://example.com/collections/new-in?utm=x")
    ).toBe("collection");
    expect(classifyCtaDestination("https://example.com/")).toBe("homepage");
    expect(classifyCtaDestination("https://example.com")).toBe("homepage");
    expect(
      classifyCtaDestination("https://example.com/journal/spring-stories")
    ).toBe("editorial");
    expect(classifyCtaDestination("https://example.com/about-us")).toBe(
      "other"
    );
  });

  it("handles Danish path conventions", () => {
    expect(classifyCtaDestination("https://example.dk/produkter/skjorte")).toBe(
      "product"
    );
    expect(classifyCtaDestination("https://example.dk/kategori/nyheder")).toBe(
      "collection"
    );
  });

  it("works for relative hrefs", () => {
    expect(classifyCtaDestination("/products/abc")).toBe("product");
  });

  it("returns null for unusable values", () => {
    expect(classifyCtaDestination(null)).toBeNull();
    expect(classifyCtaDestination("")).toBeNull();
    expect(classifyCtaDestination("   ")).toBeNull();
    expect(classifyCtaDestination("mailto:hello@example.com")).toBeNull();
    expect(classifyCtaDestination("tel:+4512345678")).toBeNull();
  });

  it("buckets tracking redirectors as other instead of guessing", () => {
    expect(
      classifyCtaDestination("https://trk.klclick.com/ls/click?upn=abc123")
    ).toBe("other");
  });
});
