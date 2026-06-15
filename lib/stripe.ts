import Stripe from "stripe";

/**
 * Shared Stripe client + plan/price plumbing.
 *
 * Mirrors `lib/resend.ts`: a lazily-cached SDK client so a missing key only
 * throws when Stripe is actually used (not at import time). The price⇄plan
 * maps live here so the checkout route, the webhook, and any future billing
 * code agree on which `STRIPE_PRICE_*` env maps to which `subscriptions.plan`
 * value — the same plan strings the entitlement system already understands.
 */

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  cached = new Stripe(key);
  return cached;
}

export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }
  return secret;
}

export type PlanId = "solo" | "team";
export type Billing = "monthly" | "annual";

/**
 * How long a `past_due` subscription keeps archive access while Stripe retries
 * the failed renewal. The webhook stamps `subscriptions.grace_until` (now +
 * this many days) on entry to `past_due`; `has_archive_access()` honours it.
 * Keep this aligned with Stripe's dunning retry window in the dashboard.
 */
export const GRACE_PERIOD_DAYS = 14;

/** The four sellable prices, keyed by plan + billing period. */
const PRICE_ENV: Record<PlanId, Record<Billing, string>> = {
  solo: {
    monthly: "STRIPE_PRICE_SOLO_MONTHLY",
    annual: "STRIPE_PRICE_SOLO_YEARLY",
  },
  team: {
    monthly: "STRIPE_PRICE_TEAM_MONTHLY",
    annual: "STRIPE_PRICE_TEAM_YEARLY",
  },
};

/** Resolve a (plan, billing) selection to its configured Stripe price ID. */
export function priceIdFor(plan: PlanId, billing: Billing): string {
  const envVar = PRICE_ENV[plan]?.[billing];
  const value = envVar ? process.env[envVar] : undefined;
  if (!value) {
    throw new Error(`Missing price env ${envVar} for ${plan}/${billing}`);
  }
  return value;
}

/**
 * Reverse map: a Stripe price ID back to its plan, so the webhook can record
 * which plan a subscription is for. Built once from the env at call time.
 * Returns null for an unrecognised price (e.g. a legacy or test-only price).
 */
export function planForPriceId(priceId: string): PlanId | null {
  for (const plan of Object.keys(PRICE_ENV) as PlanId[]) {
    for (const billing of Object.keys(PRICE_ENV[plan]) as Billing[]) {
      if (process.env[PRICE_ENV[plan][billing]] === priceId) {
        return plan;
      }
    }
  }
  return null;
}

/**
 * The period-end of a subscription as an ISO string, tolerant of where Stripe
 * exposes it: top-level `current_period_end` on older API versions, or on the
 * first subscription item on newer ones. Used to set
 * `subscriptions.current_period_end`, which the entitlement check honours.
 */
export function periodEndIso(sub: Stripe.Subscription): string | null {
  const top = (sub as unknown as { current_period_end?: number })
    .current_period_end;
  const item = sub.items?.data?.[0]?.current_period_end;
  const seconds = top ?? item;
  return typeof seconds === "number"
    ? new Date(seconds * 1000).toISOString()
    : null;
}
