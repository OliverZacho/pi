import { describe, expect, it } from "vitest";
import {
  MAX_ONBOARDING_FOLLOWS,
  MIN_ONBOARDING_FOLLOWS,
  ONBOARDING_ROLES,
  parseOnboardingCompletion
} from "@/lib/onboarding";

/**
 * `parseOnboardingCompletion` is the only validation between the browser
 * and the service-role writes in /api/onboarding/complete (batch follows,
 * brand_requests inserts, profile stamp), so its shape and bounds checks
 * are pinned here without a DB.
 */

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function follows(count: number): string[] {
  return Array.from({ length: count }, (_, i) => uuid(i + 1));
}

describe("parseOnboardingCompletion", () => {
  it("rejects non-object bodies", () => {
    for (const body of [null, undefined, "x", 42, []]) {
      const result = parseOnboardingCompletion(body);
      if (Array.isArray(body)) {
        // Arrays are objects; they fall through to field validation and
        // come back as an empty (skip-invalid) payload — rejected on the
        // pick minimum instead.
        expect(result.ok).toBe(false);
        continue;
      }
      expect(result.ok).toBe(false);
    }
  });

  it("accepts a bare skip and keeps partial answers", () => {
    const result = parseOnboardingCompletion({
      skipped: true,
      role: "founder",
      categories: ["Fashion", "fashion", " ecommerce "]
    });
    expect(result).toMatchObject({
      ok: true,
      payload: {
        skipped: true,
        role: "founder",
        categories: ["fashion", "ecommerce"],
        follows: [],
        requests: []
      }
    });
  });

  it("accepts every declared role and rejects unknown ones", () => {
    for (const role of ONBOARDING_ROLES) {
      expect(
        parseOnboardingCompletion({ skipped: true, role }).ok
      ).toBe(true);
    }
    expect(
      parseOnboardingCompletion({ skipped: true, role: "ceo" }).ok
    ).toBe(false);
  });

  it("enforces the 3-20 pick window on completion", () => {
    expect(parseOnboardingCompletion({ follows: follows(2) }).ok).toBe(false);
    expect(parseOnboardingCompletion({ follows: follows(3) }).ok).toBe(true);
    expect(parseOnboardingCompletion({ follows: follows(20) }).ok).toBe(true);
    expect(parseOnboardingCompletion({ follows: follows(21) }).ok).toBe(false);
    expect(MIN_ONBOARDING_FOLLOWS).toBe(3);
    expect(MAX_ONBOARDING_FOLLOWS).toBe(20);
  });

  it("counts follows and requests toward the same total", () => {
    const result = parseOnboardingCompletion({
      follows: follows(2),
      requests: [{ name: "Ganni", domain: "ganni.com" }]
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.follows).toHaveLength(2);
      expect(result.payload.requests).toHaveLength(1);
    }
  });

  it("dedupes follows and rejects non-UUID ids", () => {
    const result = parseOnboardingCompletion({
      follows: [uuid(1), uuid(1), uuid(2), uuid(3)]
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.follows).toHaveLength(3);

    expect(
      parseOnboardingCompletion({ follows: ["not-a-uuid", uuid(1), uuid(2)] })
        .ok
    ).toBe(false);
  });

  it("normalizes request domains and dedupes by host", () => {
    const result = parseOnboardingCompletion({
      follows: follows(2),
      requests: [
        { name: "Ganni", domain: "https://www.ganni.com/en" },
        { name: "Ganni again", domain: "ganni.com" }
      ]
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.requests).toEqual([
        { name: "Ganni", domain: "ganni.com" }
      ]);
    }
  });

  it("rejects requests with missing or oversized fields", () => {
    expect(
      parseOnboardingCompletion({
        follows: follows(3),
        requests: [{ name: "", domain: "x.com" }]
      }).ok
    ).toBe(false);
    expect(
      parseOnboardingCompletion({
        follows: follows(3),
        requests: [{ name: "a".repeat(201), domain: "x.com" }]
      }).ok
    ).toBe(false);
    expect(
      parseOnboardingCompletion({
        follows: follows(3),
        requests: [{ name: "X", domain: "   " }]
      }).ok
    ).toBe(false);
  });

  it("normalizes the own-brand domain and rejects garbage", () => {
    const ok = parseOnboardingCompletion({
      skipped: true,
      ownBrandDomain: "https://www.arket.com/en"
    });
    expect(ok).toMatchObject({
      ok: true,
      payload: { ownBrandDomain: "arket.com" }
    });
    expect(
      parseOnboardingCompletion({ skipped: true, ownBrandDomain: 42 }).ok
    ).toBe(false);
  });
});
