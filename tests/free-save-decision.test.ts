import { describe, expect, it } from "vitest";
import { freeSaveDecision } from "@/lib/saved-emails-db";

/**
 * `freeSaveDecision` is the pure gate the save API applies to non-entitled
 * (free) users before writing a bookmark. The only rule is the cap (free
 * users can already view the whole archive, so there's no content
 * restriction), plus an idempotency carve-out — worth pinning down
 * without a DB.
 */
const LIMIT = 25;

describe("freeSaveDecision", () => {
  it("allows a new save under the cap", () => {
    expect(freeSaveDecision({ alreadySaved: false, count: 0, limit: LIMIT })).toEqual({
      ok: true
    });
  });

  it("rejects with 409 once the cap is reached", () => {
    const result = freeSaveDecision({ alreadySaved: false, count: LIMIT, limit: LIMIT });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("SAVE_LIMIT_REACHED");
    }
  });

  it("treats re-saving an already-saved email as an idempotent no-op", () => {
    // Even over the cap, re-saving must succeed so a repeated PUT never
    // errors.
    expect(
      freeSaveDecision({ alreadySaved: true, count: 999, limit: LIMIT })
    ).toEqual({ ok: true });
  });

  it("blocks the email that would exceed the cap, not just past it", () => {
    // count === limit is the boundary: already at 25 means the 26th is
    // refused.
    expect(freeSaveDecision({ alreadySaved: false, count: LIMIT - 1, limit: LIMIT }).ok).toBe(
      true
    );
    expect(freeSaveDecision({ alreadySaved: false, count: LIMIT, limit: LIMIT }).ok).toBe(
      false
    );
  });
});
