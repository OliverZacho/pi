import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  getStripe,
  priceIdFor,
  type Billing,
  type PlanId,
} from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PLANS: PlanId[] = ["solo", "team"];
const BILLINGS: Billing[] = ["monthly", "annual"];

/** Absolute origin for return URLs, honouring proxy headers in prod. */
function originOf(request: Request): string {
  const fromHeader = request.headers.get("origin");
  if (fromHeader) return fromHeader;
  const host = request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

/**
 * POST `/api/checkout` — start a Stripe Checkout Session for the signed-in
 * user to subscribe to a plan. Requires only login (not entitlement — they're
 * paying to *get* entitlement). The user's id rides along as
 * `client_reference_id` and on the subscription metadata so the webhook can
 * map the resulting subscription back to them. Returns `{ url }` to redirect to.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  let body: { plan?: string; billing?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const plan = body.plan as PlanId;
  const billing = body.billing as Billing;
  if (!PLANS.includes(plan) || !BILLINGS.includes(billing)) {
    return NextResponse.json(
      { error: "Invalid plan or billing period" },
      { status: 400 }
    );
  }

  const stripe = getStripe();
  const admin = getSupabaseAdmin();
  const origin = originOf(request);

  try {
    // Reuse this user's Stripe customer if we've seen one, else create it and
    // remember it immediately (status stays 'inactive' until the webhook
    // confirms payment) so repeat checkouts don't spawn duplicate customers.
    const { data: existing } = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", session.user.id)
      .maybeSingle();

    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: session.user.email ?? undefined,
        metadata: { user_id: session.user.id },
      });
      customerId = customer.id;
      await admin.from("subscriptions").upsert(
        {
          user_id: session.user.id,
          stripe_customer_id: customerId,
          status: "inactive",
        },
        { onConflict: "user_id" }
      );
    }

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: session.user.id,
      line_items: [{ price: priceIdFor(plan, billing), quantity: 1 }],
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { user_id: session.user.id, plan },
      },
      success_url: `${origin}/explore?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
    });

    if (!checkout.url) {
      return NextResponse.json(
        { error: "Stripe did not return a checkout URL" },
        { status: 502 }
      );
    }
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    console.error("Failed to create checkout session", error);
    return NextResponse.json(
      { error: "Failed to start checkout" },
      { status: 500 }
    );
  }
}
