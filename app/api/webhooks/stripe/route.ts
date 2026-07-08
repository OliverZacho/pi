import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, getStripeWebhookSecret } from "@/lib/stripe";
import { syncSubscription } from "@/lib/stripe-sync";

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
