import { describe, expect, it } from "vitest";
import {
  isFreshSignup,
  isSignupSource,
  labelForSignupSource,
  signupSourceForNext
} from "@/lib/signup-source";

describe("signupSourceForNext", () => {
  it("is the trial button for a Solo checkout resume", () => {
    expect(signupSourceForNext("/api/checkout/continue?plan=solo&billing=monthly")).toBe("trial");
  });

  it("is a checkout for non-trial plans and the pricing page", () => {
    expect(signupSourceForNext("/api/checkout/continue?plan=team&billing=annual")).toBe("checkout");
    expect(signupSourceForNext("/pricing")).toBe("checkout");
    expect(signupSourceForNext("/pricing?checkout=cancelled")).toBe("checkout");
  });

  it("is a plain sign-up otherwise", () => {
    expect(signupSourceForNext(null)).toBe("signup");
    expect(signupSourceForNext("/explore")).toBe("signup");
    expect(signupSourceForNext("/pricing-guide")).toBe("signup");
  });
});

describe("signup source helpers", () => {
  it("validates source tags", () => {
    expect(isSignupSource("trial")).toBe(true);
    expect(isSignupSource("TRIAL")).toBe(false);
    expect(isSignupSource(null)).toBe(false);
  });

  it("labels unknown sources honestly", () => {
    expect(labelForSignupSource("invite")).toBe("Team invite");
    expect(labelForSignupSource(null)).toMatch(/unknown/i);
    expect(labelForSignupSource("garbage")).toMatch(/unknown/i);
  });

  it("treats only accounts under 15 minutes old as fresh", () => {
    const now = Date.parse("2026-09-12T10:00:00Z");
    expect(isFreshSignup("2026-09-12T09:50:00Z", now)).toBe(true);
    expect(isFreshSignup("2026-09-12T09:40:00Z", now)).toBe(false);
    expect(isFreshSignup("not a date", now)).toBe(false);
  });
});
