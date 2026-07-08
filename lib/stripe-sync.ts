import type Stripe from "stripe";
import {
  getStripe,
  planForPriceId,
  periodEndIso,
  GRACE_PERIOD_DAYS,
} from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * Write a Stripe subscription's current state into `public.subscriptions`.
 *
 * Shared by the webhook (`/api/webhooks/stripe`) and the checkout success
 * landing ({@link syncCheckoutSuccess}), so entitlement never depends on
 * which of the two happens to run first — both project the same full current
 * state keyed on `user_id`, and redeliveries or races converge rather than
 * corrupt.
 *
 * Resolves the owning user from the metadata hint first; if absent (e.g. an
 * event whose subscription metadata wasn't set), falls back to matching the
 * Stripe customer id we stored at checkout. Without a user we can't attribute
 * the row, so we log and skip rather than guess.
 */
export async function syncSubscription(
  sub: Stripe.Subscription,
  userIdHint: string | null
): Promise<void> {
  const admin = getSupabaseAdmin();
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // Resolve the user and read the prior row in one go — we need the existing
  // status/grace to decide whether this is a *fresh* entry into past_due.
  let userId = userIdHint;
  let prior:
    | { user_id: string; status: string; grace_until: string | null }
    | null = null;
  if (userId) {
    const { data } = await admin
      .from("subscriptions")
      .select("user_id, status, grace_until")
      .eq("user_id", userId)
      .maybeSingle();
    prior = data;
  } else {
    const { data } = await admin
      .from("subscriptions")
      .select("user_id, status, grace_until")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    prior = data;
    userId = data?.user_id ?? null;
  }
  if (!userId) {
    console.error(
      `Stripe subscription ${sub.id} has no resolvable user (customer ${customerId})`
    );
    return;
  }

  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const plan =
    (sub.metadata?.plan as string | undefined) ??
    (priceId ? planForPriceId(priceId) : null);

  // Grace window: start the clock on the *transition* into past_due (keep an
  // already-running window so retries don't keep pushing it out); clear it on
  // any other status so a recovered or cancelled sub doesn't linger.
  let graceUntil: string | null = null;
  if (sub.status === "past_due") {
    graceUntil =
      prior?.status === "past_due" && prior.grace_until
        ? prior.grace_until
        : new Date(
            Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
          ).toISOString();
  }

  const { error } = await admin.from("subscriptions").upsert(
    {
      user_id: userId,
      status: sub.status,
      plan,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      current_period_end: periodEndIso(sub),
      grace_until: graceUntil,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) {
    throw new Error(`subscriptions upsert failed: ${error.message}`);
  }

  // A live paid sub also counts as the onboarding plan choice: without this,
  // a customer who never clicked "Free" in the plan modal would be dropped
  // back into the forced tour/modal if their subscription ever lapsed.
  // Only fills a null stamp, so the original choice timestamp is preserved
  // and webhook redeliveries stay idempotent. Non-fatal: entitlement is
  // already written, so a failed stamp must not error the webhook.
  if (sub.status === "active" || sub.status === "trialing") {
    const now = new Date().toISOString();
    const { error: stampError } = await admin
      .from("user_profiles")
      .update({ plan_selected_at: now, updated_at: now })
      .eq("user_id", userId)
      .is("plan_selected_at", null);
    if (stampError) {
      console.error(
        `Failed to stamp plan_selected_at for ${userId}`,
        stampError
      );
    }
  }
}

/**
 * Reconcile entitlement straight from a Checkout Session id — called on the
 * `/explore?checkout=success` landing so a fresh subscriber is unlocked even
 * when Stripe's webhook hasn't arrived yet (it usually lags the redirect by
 * a few seconds, and endpoint misconfiguration would otherwise lock a paying
 * customer out entirely).
 *
 * Verifies the session belongs to `userId` before writing anything. Returns
 * whether the subscription is live (active/trialing); errors just return
 * false — the webhook remains the safety net.
 */
export async function syncCheckoutSuccess(
  sessionId: string,
  userId: string
): Promise<boolean> {
  try {
    const stripe = getStripe();
    const checkout = await stripe.checkout.sessions.retrieve(sessionId);
    if (checkout.client_reference_id !== userId) return false;
    if (checkout.mode !== "subscription" || !checkout.subscription)
      return false;
    const sub = await stripe.subscriptions.retrieve(
      typeof checkout.subscription === "string"
        ? checkout.subscription
        : checkout.subscription.id
    );
    await syncSubscription(sub, userId);
    return sub.status === "active" || sub.status === "trialing";
  } catch (error) {
    console.error("Checkout success sync failed", error);
    return false;
  }
}
