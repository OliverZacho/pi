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

  it("drops popular-but-unrelated hits when a query is given", () => {
    const merged = mergeBrandSearchResults(
      [],
      [
        { name: "Walmart", domain: "walmart.com" },
        { name: "Wal", domain: "wal-mart.com" },
        { name: "Walmart Canada", domain: "walmart.ca" },
        { name: "LinkedIn", domain: "linkedin.com" },
        { name: "Walmart IO", domain: "walmart.io" }
      ],
      { query: "Walmart", limit: 10 }
    );
    expect(merged.map((item) => item.domain)).toEqual([
      "walmart.com",
      "wal-mart.com",
      "walmart.ca",
      "walmart.io"
    ]);
  });

  it("caps the list at three by default, in Logo.dev order", () => {
    const merged = mergeBrandSearchResults(
      [],
      [
        { name: "Walmart", domain: "walmart.com" },
        { name: "Wal", domain: "wal-mart.com" },
        { name: "Walmart Canada", domain: "walmart.ca" },
        { name: "Walmart IO", domain: "walmart.io" }
      ],
      { query: "Walmart" }
    );
    expect(merged).toHaveLength(3);
    expect(merged[2].domain).toBe("walmart.ca");
  });

  it("does not let filtered or tracked rows eat into the cap", () => {
    const merged = mergeBrandSearchResults(
      ["walmart.com"],
      [
        { name: "Walmart", domain: "walmart.com" },
        { name: "LinkedIn", domain: "linkedin.com" },
        { name: "Wal", domain: "wal-mart.com" },
        { name: "Walmart Canada", domain: "walmart.ca" },
        { name: "Walmart IO", domain: "walmart.io" }
      ],
      { query: "Walmart" }
    );
    expect(merged.map((item) => item.domain)).toEqual([
      "wal-mart.com",
      "walmart.ca",
      "walmart.io"
    ]);
  });

  it("matches on the query containing the brand name (short queries)", () => {
    const merged = mergeBrandSearchResults(
      [],
      [{ name: "Ganni", domain: "ganni.com" }],
      { query: "ganni studio" }
    );
    expect(merged).toHaveLength(1);
  });
});
