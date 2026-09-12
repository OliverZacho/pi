import { planOffersTrial } from "@/lib/trial";
import type { PlanId } from "@/lib/stripe";

/**
 * Which door an account came in through, stamped on `user_profiles` once
 * per account (see `stampSignupSource` and the auth trigger). The admin
 * panel ranks signups and paid conversions by it.
 *
 *  - signup     the plain "Sign up" / "Start free" buttons → /signup
 *  - trial      the homepage "Start 14-day free trial" button
 *  - checkout   a pricing-page checkout that had to sign up first
 *  - plan_modal the inline signup inside the in-app plan modal
 *  - invite     joined a team through an invite
 */
export const SIGNUP_SOURCES = [
  "signup",
  "trial",
  "checkout",
  "plan_modal",
  "invite"
] as const;

export type SignupSource = (typeof SIGNUP_SOURCES)[number];

export const SIGNUP_SOURCE_LABELS: Record<SignupSource | "unknown", string> = {
  signup: "Sign-up button",
  trial: "Free-trial button",
  checkout: "Pricing checkout",
  plan_modal: "In-app plan modal",
  invite: "Team invite",
  unknown: "Unknown (before tracking)"
};

/** Terse form for the admin signups feed's meta line. */
export const SIGNUP_SOURCE_SHORT_LABELS: Record<SignupSource, string> = {
  signup: "sign-up button",
  trial: "trial button",
  checkout: "checkout",
  plan_modal: "plan modal",
  invite: "invite"
};

export function isSignupSource(value: unknown): value is SignupSource {
  return (
    typeof value === "string" &&
    (SIGNUP_SOURCES as readonly string[]).includes(value)
  );
}

export function labelForSignupSource(source: string | null): string {
  return isSignupSource(source)
    ? SIGNUP_SOURCE_LABELS[source]
    : SIGNUP_SOURCE_LABELS.unknown;
}

/**
 * The source implied by where /signup will send the account afterwards.
 * A checkout resume for a trial plan is the free-trial button; any other
 * checkout resume or the pricing page is a checkout; everything else is a
 * plain sign-up.
 */
export function signupSourceForNext(next: string | null): SignupSource {
  if (!next) return "signup";
  if (next.startsWith("/api/checkout/continue")) {
    const plan = new URL(next, "http://x").searchParams.get("plan") as PlanId | null;
    return plan && planOffersTrial(plan) ? "trial" : "checkout";
  }
  if (next === "/pricing" || next.startsWith("/pricing?")) return "checkout";
  return "signup";
}

/**
 * Whether an auth landing belongs to an account created moments ago, so
 * /auth/callback only stamps a source on genuine signups and never on an
 * old account's routine login.
 */
export function isFreshSignup(createdAt: string, now: number = Date.now()): boolean {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && now - created < 15 * 60_000;
}
