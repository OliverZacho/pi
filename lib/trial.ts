import type { PlanId } from "@/lib/stripe";

/**
 * The free-trial rules, in one place.
 *
 * Deliberately free of the Stripe SDK (the `PlanId` import is type-only, so
 * it's erased at build) — upgrade CTAs are client components and need the
 * same length and the same eligibility predicate the server applies, so a
 * button can never promise a trial that checkout won't actually give.
 */

/**
 * Length of the free trial offered on a first Solo checkout. Stripe collects
 * the card up front, holds the subscription in `trialing` for this long
 * (already an entitled status in `has_archive_access()`), then charges and
 * flips it to `active` on its own.
 */
export const TRIAL_PERIOD_DAYS = 14;

/**
 * Where a "start your free trial" link sends the visitor. The route opens
 * Stripe Checkout for Solo straight away when they're signed in, and
 * otherwise routes them through /signup (or /login) and back into Checkout
 * once the session exists. Monthly, because the marketing cards quote the
 * €/month price next to the button; Checkout itself shows the annual option.
 *
 * Link to it with a plain `<a>`, not next/link: a Link would prefetch the
 * route handler and open a Stripe session for every signed-in visitor who
 * merely scrolled past the button.
 */
export const SOLO_TRIAL_CHECKOUT_HREF =
  "/api/checkout/continue?plan=solo&billing=monthly";

/**
 * Which plans open with a trial. Solo only: a trialing Team owner would hand
 * five other people free access for two weeks, and team member entitlement is
 * derived from the owner's subscription, so an unconverted team trial would
 * revoke access for the whole team at once.
 */
const TRIAL_PLANS: readonly PlanId[] = ["solo"];

/** Whether `plan` is one we ever offer a trial on, independent of the buyer. */
export function planOffersTrial(plan: PlanId): boolean {
  return TRIAL_PLANS.includes(plan);
}

/**
 * Whether a checkout for `plan` may include the free trial.
 *
 * `subscription` is the account's existing `subscriptions` row (null for an
 * account that has never reached checkout). One trial per account, forever:
 * `trial_started_at` is stamped by the webhook and never cleared, and an
 * account that already holds a `stripe_subscription_id` has been a paying
 * customer at some point, so lapsing and coming back doesn't earn a trial
 * either.
 */
export function trialEligible(
  plan: PlanId,
  subscription: {
    trial_started_at?: string | null;
    stripe_subscription_id?: string | null;
  } | null
): boolean {
  if (!planOffersTrial(plan)) return false;
  if (!subscription) return true;
  return !subscription.trial_started_at && !subscription.stripe_subscription_id;
}
