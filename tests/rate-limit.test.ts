import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";

describe("createRateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to the limit, then refuses", () => {
    const allow = createRateLimiter({ limit: 3, windowMs: 60_000 });
    expect([allow("a"), allow("a"), allow("a")]).toEqual([true, true, true]);
    expect(allow("a")).toBe(false);
    expect(allow("a")).toBe(false);
  });

  it("counts each key on its own", () => {
    const allow = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(allow("a")).toBe(true);
    expect(allow("a")).toBe(false);
    expect(allow("b")).toBe(true);
  });

  it("starts a fresh count once the window has passed", () => {
    vi.useFakeTimers();
    const allow = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(allow("a")).toBe(true);
    expect(allow("a")).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(allow("a")).toBe(true);
  });
});
