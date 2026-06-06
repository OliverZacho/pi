import { describe, expect, it } from "vitest";
import {
  isManualLogoStale,
  LOGO_MANUAL_STALE_AFTER_EMAILS
} from "@/lib/company-logos";

const T = LOGO_MANUAL_STALE_AFTER_EMAILS; // 10

function emails(count: number, withLogo: boolean): string[][] {
  return Array.from({ length: count }, () =>
    withLogo ? ["abc/logo.png", "abc/other.png"] : ["abc/other.png"]
  );
}

describe("isManualLogoStale", () => {
  it("is not stale when there are fewer than the threshold of emails", () => {
    expect(isManualLogoStale("abc/logo.png", emails(T - 1, false))).toBe(false);
  });

  it("is stale when the pick is absent from the most-recent threshold emails", () => {
    expect(isManualLogoStale("abc/logo.png", emails(T, false))).toBe(true);
  });

  it("is not stale when the pick still appears in the recent window", () => {
    const recent = [...emails(1, true), ...emails(T + 5, false)];
    expect(isManualLogoStale("abc/logo.png", recent)).toBe(false);
  });

  it("only considers the most-recent threshold emails (a run breaks staleness)", () => {
    // 9 most-recent without it, then one with it within the window of 10.
    const recent = [...emails(T - 1, false), ...emails(1, true), ...emails(20, false)];
    expect(isManualLogoStale("abc/logo.png", recent)).toBe(false);
  });

  it("returns false for a null manual path", () => {
    expect(isManualLogoStale(null, emails(T, false))).toBe(false);
  });
});
