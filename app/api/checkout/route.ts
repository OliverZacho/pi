import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import type { Billing, PlanId } from "@/lib/stripe";
import {
  CHECKOUT_BILLINGS,
  CHECKOUT_PLANS,
  originOf,
  startCheckoutSession,
} from "@/lib/checkout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST `/api/checkout` — start a Stripe Checkout Session for the signed-in
 * user to subscribe to a plan. Requires only login (not entitlement — they're
 * paying to *get* entitlement). Returns `{ url }` to redirect to, or
 * `{ alreadyActive: true }` when they already have a live subscription.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  let body: {
    plan?: string;
    billing?: string;
    name?: string;
    isBusiness?: boolean;
    company?: string;
    vatNumber?: string;
    country?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const plan = body.plan as PlanId;
  const billing = body.billing as Billing;
  if (!CHECKOUT_PLANS.includes(plan) || !CHECKOUT_BILLINGS.includes(billing)) {
    return NextResponse.json(
      { error: "Invalid plan or billing period" },
      { status: 400 }
    );
  }

  try {
    const result = await startCheckoutSession({
      userId: session.user.id,
      userEmail: session.user.email,
      plan,
      billing,
      origin: originOf(request),
      buyer: {
        name: body.name,
        isBusiness: body.isBusiness,
        company: body.company,
        vatNumber: body.vatNumber,
        country: body.country,
      },
    });
    if (result.kind === "alreadyActive") {
      return NextResponse.json({ alreadyActive: true });
    }
    return NextResponse.json({ url: result.url });
  } catch (error) {
    console.error("Failed to create checkout session", error);
    return NextResponse.json(
      { error: "Failed to start checkout" },
      { status: 500 }
    );
  }
}
