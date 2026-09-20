import { describe, expect, it } from "vitest";
import { looksAdult } from "@/lib/adult-brand-filter";
import { mergeBrandSearchResults } from "@/lib/logo-dev-search";

describe("looksAdult", () => {
  it("flags adult queries, names and hosts", () => {
    for (const value of [
      "porn",
      "Pornhub",
      "pornhubpremium",
      "PornHat",
      "porno",
      "XVideos",
      "OnlyFans",
      "Sex Shop",
      "erotic-boutique",
      "nsfw"
    ]) {
      expect(looksAdult(value), value).toBe(true);
    }
  });

  it("leaves ordinary brands alone, including near-misses on token terms", () => {
    for (const value of [
      "Arket",
      "Essex Cricket",
      "sussex",
      "Unisex Studio",
      "Milford",
      "Nudestix",
      "Adult Swim",
      "xero"
    ]) {
      expect(looksAdult(value), value).toBe(false);
    }
  });

  it("returns false for empty input", () => {
    expect(looksAdult("")).toBe(false);
    expect(looksAdult("  ---  ")).toBe(false);
  });
});

describe("mergeBrandSearchResults adult filter", () => {
  it("drops adult hits even when they match the query", () => {
    const merged = mergeBrandSearchResults(
      [],
      [
        { name: "Pornhub", domain: "pornhub.com" },
        { name: "PornBay", domain: "pornbay.org" },
        { name: "PORNO", domain: "porno.biz" }
      ],
      { query: "porn", limit: 5 }
    );
    expect(merged).toEqual([]);
  });

  it("drops an adult hit by host when the name looks innocent", () => {
    const merged = mergeBrandSearchResults(
      [],
      [
        { name: "Hub", domain: "pornhub.com" },
        { name: "Hubspot", domain: "hubspot.com" }
      ],
      { query: "hub", limit: 5 }
    );
    expect(merged).toEqual([{ name: "Hubspot", domain: "hubspot.com" }]);
  });
});
