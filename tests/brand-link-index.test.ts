import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdmin: () => null }));
vi.mock("@/lib/storage", () => ({
  BRAND_LOGO_TRANSFORM: {},
  getSignedAssets: async () => ({})
}));

const { pickRelatedBrands } = await import("@/lib/brand-link-index");
type IndexedBrand = Parameters<typeof pickRelatedBrands>[0][number];

function brand(
  name: string,
  markets: string[],
  country: string | null = "DK"
): IndexedBrand {
  return {
    id: name,
    slug: name.toLowerCase(),
    name,
    markets,
    country,
    domain: null,
    logoStoragePath: null,
    logoSource: null,
    emailCount: 50
  };
}

describe("pickRelatedBrands", () => {
  it("prefers same-market brands from the same country", () => {
    const index = [
      brand("Aarhus Wear", ["fashion"], "DK"),
      brand("Berlin Mode", ["fashion"], "DE"),
      brand("Copenhagen Knit", ["fashion"], "DK"),
      brand("Danish Denim", ["fashion"], "DK"),
      brand("Stockholm Style", ["fashion"], "SE"),
      brand("Lamp House", ["home & living"], "DK")
    ];
    const pick = pickRelatedBrands(index, index[0], 2);
    expect(pick.brands.map((b) => b.name)).toEqual([
      "Copenhagen Knit",
      "Danish Denim"
    ]);
    expect(pick.sharedMarket).toBe("fashion");
  });

  it("links every brand in a market from at least one other brand", () => {
    const countries = ["DK", "SE", "GB", null, "US"];
    const index = Array.from({ length: 30 }, (_, i) =>
      brand(`Brand ${String(i).padStart(2, "0")}`, ["fashion"], countries[i % 5])
    );
    const inbound = new Map<string, number>();
    for (const b of index) {
      for (const r of pickRelatedBrands(index, b, 8).brands) {
        inbound.set(r.id, (inbound.get(r.id) ?? 0) + 1);
      }
    }
    for (const b of index) {
      expect(inbound.get(b.id) ?? 0).toBeGreaterThanOrEqual(8);
    }
  });

  it("tops up a small market and drops the market heading when mixed", () => {
    const index = [
      brand("Pet Co", ["pets"]),
      brand("Paw Shop", ["pets"]),
      brand("Gift Store", ["retail", "pets"]),
      brand("Big Box", ["retail"])
    ];
    const pick = pickRelatedBrands(
      index,
      { id: "new", name: "New Pets", markets: ["pets", "retail"], country: "DK" },
      4
    );
    expect(pick.brands.map((b) => b.name).sort()).toEqual([
      "Big Box",
      "Gift Store",
      "Paw Shop",
      "Pet Co"
    ]);
    expect(pick.sharedMarket).toBeNull();
  });

  it("never links a brand to itself", () => {
    const index = [brand("Solo", ["fashion"]), brand("Other", ["fashion"])];
    const pick = pickRelatedBrands(index, index[0], 8);
    expect(pick.brands.map((b) => b.name)).toEqual(["Other"]);
  });
});
