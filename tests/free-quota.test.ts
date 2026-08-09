import { describe, expect, it } from "vitest";
import { freeQuotaDecision } from "@/lib/free-quota";

/**
 * `freeQuotaDecision` is the shared pure gate behind every free-tier cap
 * (saves, follows, collections, comparisons). The boundary semantics and
 * the idempotency carve-out are load-bearing across four features, so
 * they're pinned here without a DB. `freeSaveDecision`'s own suite keeps
 * covering the save-specific wrapper.
 */

const FOLLOW = {
  code: "FOLLOW_LIMIT_REACHED" as const,
  error: "Free accounts can follow up to 25 brands. Upgrade to follow more."
};

describe("freeQuotaDecision", () => {
  it("allows a new item under the cap", () => {
    expect(
      freeQuotaDecision({ alreadyPresent: false, count: 0, limit: 25, ...FOLLOW })
    ).toEqual({ ok: true });
  });

  it("rejects with 409 and the feature's code once the cap is reached", () => {
    const result = freeQuotaDecision({
      alreadyPresent: false,
      count: 25,
      limit: 25,
      ...FOLLOW
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("FOLLOW_LIMIT_REACHED");
      expect(result.error).toContain("25");
    }
  });

  it("treats a repeat of an already-held item as an idempotent no-op", () => {
    // Even over the cap, a re-follow / re-save must succeed so a
    // repeated PUT never errors.
    expect(
      freeQuotaDecision({ alreadyPresent: true, count: 999, limit: 25, ...FOLLOW })
    ).toEqual({ ok: true });
  });

  it("blocks exactly the item that would exceed the cap", () => {
    // count === limit is the boundary: at 25 the 26th is refused; a
    // delete that brings the count back under frees a slot.
    expect(
      freeQuotaDecision({ alreadyPresent: false, count: 24, limit: 25, ...FOLLOW }).ok
    ).toBe(true);
    expect(
      freeQuotaDecision({ alreadyPresent: false, count: 25, limit: 25, ...FOLLOW }).ok
    ).toBe(false);
  });

  it("caps of 1 gate the second create, not the first", () => {
    const COLLECTION = {
      code: "COLLECTION_LIMIT_REACHED" as const,
      error: "Free accounts can create 1 collection. Upgrade for unlimited collections."
    };
    expect(
      freeQuotaDecision({ alreadyPresent: false, count: 0, limit: 1, ...COLLECTION }).ok
    ).toBe(true);
    expect(
      freeQuotaDecision({ alreadyPresent: false, count: 1, limit: 1, ...COLLECTION }).ok
    ).toBe(false);
  });
});
