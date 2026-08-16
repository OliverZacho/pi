import { describe, expect, it } from "vitest";
import { planOffersTrial, trialEligible, TRIAL_PERIOD_DAYS } from "@/lib/trial";

/**
 * `trialEligible` is the single gate deciding whether a checkout opens with a
 * free trial. It runs in two places that must never disagree — the CTA label
 * (`useTrialEligibility` via `/api/billing/status`) and the Stripe session
 * itself (`startCheckoutSession`) — and the "one trial per account, forever"
 * rule is the whole abuse defence, so the cases are pinned here without a DB.
 */

describe("planOffersTrial", () => {
  it("offers a trial on Solo only", () => {
    expect(planOffersTrial("solo")).toBe(true);
    expect(planOffersTrial("team")).toBe(false);
  });
});

describe("trialEligible", () => {
  it("allows an account that has never reached checkout", () => {
    expect(trialEligible("solo", null)).toBe(true);
  });

  it("allows an account with a customer but no subscription yet", () => {
    // startCheckoutSession writes this row the moment it creates the Stripe
    // customer, so an abandoned checkout must not burn the trial.
    expect(
      trialEligible("solo", {
        trial_started_at: null,
        stripe_subscription_id: null
      })
    ).toBe(true);
  });

  it("refuses a second trial once one has been used", () => {
    expect(
      trialEligible("solo", {
        trial_started_at: "2026-08-01T00:00:00.000Z",
        stripe_subscription_id: null
      })
    ).toBe(false);
  });

  it("refuses a trial to anyone who has ever held a subscription", () => {
    // A customer who paid full price, cancelled, and came back doesn't get a
    // trial on the way in — they've already had the product.
    expect(
      trialEligible("solo", {
        trial_started_at: null,
        stripe_subscription_id: "sub_123"
      })
    ).toBe(false);
  });

  it("never offers a trial on Team, however clean the account", () => {
    expect(trialEligible("team", null)).toBe(false);
    expect(
      trialEligible("team", {
        trial_started_at: null,
        stripe_subscription_id: null
      })
    ).toBe(false);
  });
});

describe("TRIAL_PERIOD_DAYS", () => {
  it("is the 14 days the pricing copy promises", () => {
    expect(TRIAL_PERIOD_DAYS).toBe(14);
  });
});
