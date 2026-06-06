import { describe, expect, it } from "vitest";
import { countryFlag, countryLabel, countryName } from "@/lib/country";

describe("country helpers", () => {
  it("derives a flag emoji from a valid code", () => {
    expect(countryFlag("DK")).toBe("🇩🇰");
    expect(countryFlag("gb")).toBe("🇬🇧");
  });

  it("names a country in English", () => {
    expect(countryName("DK")).toBe("Denmark");
    expect(countryName("US")).toBe("United States");
  });

  it("combines flag and name", () => {
    expect(countryLabel("DK")).toBe("🇩🇰 Denmark");
  });

  it("degrades gracefully on null / invalid input", () => {
    expect(countryFlag(null)).toBe("");
    expect(countryFlag("XYZ")).toBe("");
    expect(countryLabel(null)).toBe("");
    expect(countryLabel("")).toBe("");
    expect(countryName("Z")).toBe("Z");
  });
});
