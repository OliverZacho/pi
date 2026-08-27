import { describe, expect, it } from "vitest";
import { mergeBrandSearchResults } from "@/lib/logo-dev-search";

/**
 * The merge decides which Logo.dev search hits surface as "requestable"
 * untracked brands in the onboarding typeahead. A tracked brand must
 * never show up as requestable, so host-level dedupe is the contract.
 */
describe("mergeBrandSearchResults", () => {
  it("drops Logo.dev rows whose host matches a tracked domain", () => {
    const merged = mergeBrandSearchResults(
      ["https://www.arket.com/", "ganni.com"],
      [
        { name: "Arket", domain: "arket.com" },
        { name: "Ganni", domain: "www.ganni.com" },
        { name: "Toteme", domain: "toteme-studio.com" }
      ]
    );
    expect(merged).toEqual([
      { name: "Toteme", domain: "toteme-studio.com" }
    ]);
  });

  it("dedupes Logo.dev rows by host, keeping the first (most popular)", () => {
    const merged = mergeBrandSearchResults(
      [],
      [
        { name: "Toteme", domain: "toteme-studio.com" },
        { name: "Toteme Studio", domain: "https://toteme-studio.com/en" }
      ]
    );
    expect(merged).toEqual([
      { name: "Toteme", domain: "toteme-studio.com" }
    ]);
  });

  it("ignores null and unparsable tracked domains", () => {
    const merged = mergeBrandSearchResults(
      [null, undefined, ""],
      [{ name: "Toteme", domain: "toteme-studio.com" }]
    );
    expect(merged).toHaveLength(1);
  });

  it("returns empty for empty Logo.dev input", () => {
    expect(mergeBrandSearchResults(["arket.com"], [])).toEqual([]);
  });
});
