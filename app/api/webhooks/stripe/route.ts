import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  getStripe,
  getStripeWebhookSecret,
  planForPriceId,
  periodEndIso,
  GRACE_PERIOD_DAYS,
} from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST `/api/webhooks/stripe` — the bridge from Stripe to entitlement.
 *
 * Verifies Stripe's signature against the raw body, then projects the
 * subscription's current state into `public.subscriptions`. That table (plus
 * `has_archive_access()`) is the single source of truth the app and RLS both
 * read, so writing the latest state here is all it takes to grant or revoke
 * access — no extra app wiring.
 *
 * Idempotent by construction: every handler upserts the *full current state*
 * keyed on `user_id` (the table's primary key), so Stripe redeliveries and
 * out-of-order retries converge rather than corrupt. Always returns 200 once
 * the signature is valid, so Stripe doesn't retry a payload we've accepted.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      getStripeWebhookSecret()
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const checkout = event.data.object as Stripe.Checkout.Session;
        // Subscriptions only — ignore one-off payment sessions.
        if (checkout.mode !== "subscription" || !checkout.subscription) break;
        const sub = await stripe.subscriptions.retrieve(
          typeof checkout.subscription === "string"
            ? checkout.subscription
            : checkout.subscription.id
        );
        const userId =
          checkout.client_reference_id ?? sub.metadata?.user_id ?? null;
        await syncSubscription(sub, userId);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await syncSubscription(sub, sub.metadata?.user_id ?? null);
        break;
      }
      default:
        // Unhandled event types are acknowledged, not errored.
        break;
    }
  } catch (error) {
    console.error(`Failed to handle Stripe event ${event.type}`, error);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/**
 * Write a Stripe subscription's current state into `public.subscriptions`.
 *
 * Resolves the owning user from the metadata hint first; if absent (e.g. an
 * event whose subscription metadata wasn't set), falls back to matching the
 * Stripe customer id we stored at checkout. Without a user we can't attribute
 * the row, so we log and skip rather than guess.
 */
async function syncSubscription(
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
  const plan = (sub.metadata?.plan as string | undefined) ??
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
}
