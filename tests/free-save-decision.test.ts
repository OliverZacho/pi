import { describe, expect, it } from "vitest";
import { freeSaveDecision } from "@/lib/saved-emails-db";

/**
 * `freeSaveDecision` is the pure gate the save API applies to non-entitled
 * (free) users before writing a bookmark. It encodes the two free-tier
 * rules — only curated preview emails, capped at the free limit — and the
 * idempotency carve-out, so it's worth pinning down without a DB.
 */
const LIMIT = 25;

describe("freeSaveDecision", () => {
  it("allows saving a curated email under the cap", () => {
    expect(
      freeSaveDecision({ alreadySaved: false, isCurated: true, count: 0, limit: LIMIT })
    ).toEqual({ ok: true });
  });

  it("rejects a non-curated email with 403", () => {
    const result = freeSaveDecision({
      alreadySaved: false,
      isCurated: false,
      count: 0,
      limit: LIMIT
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.code).toBe("NOT_SAVEABLE");
    }
  });

  it("rejects with 409 once the cap is reached", () => {
    const result = freeSaveDecision({
      alreadySaved: false,
      isCurated: true,
      count: LIMIT,
      limit: LIMIT
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("SAVE_LIMIT_REACHED");
    }
  });

  it("treats re-saving an already-saved email as an idempotent no-op", () => {
    // Even over the cap and even if it weren't curated, re-saving must
    // succeed so a repeated PUT never errors.
    expect(
      freeSaveDecision({ alreadySaved: true, isCurated: false, count: 999, limit: LIMIT })
    ).toEqual({ ok: true });
  });

  it("blocks the email that would exceed the cap, not just past it", () => {
    // count === limit is the boundary: already at 25 means the 26th is
    // refused.
    expect(
      freeSaveDecision({ alreadySaved: false, isCurated: true, count: LIMIT - 1, limit: LIMIT }).ok
    ).toBe(true);
    expect(
      freeSaveDecision({ alreadySaved: false, isCurated: true, count: LIMIT, limit: LIMIT }).ok
    ).toBe(false);
  });
});
