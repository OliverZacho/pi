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
 * GET `/api/checkout/continue?plan=&billing=` — the resume point after a
 * Google OAuth round-trip. The upgrade modal sends `redirectTo` through
 * `/auth/callback?next=/api/checkout/continue?...`, so once the callback has
 * established the session it lands here, and we redirect straight into Stripe
 * Checkout for the plan they picked before signing in. A top-level navigation
 * (not fetch), so everything is a redirect rather than JSON.
 */
export async function GET(request: Request) {
  const origin = originOf(request);
  const url = new URL(request.url);
  const plan = url.searchParams.get("plan") as PlanId;
  const billing = url.searchParams.get("billing") as Billing;

  const session = await requireSession();
  if ("response" in session) {
    // Session didn't stick — send them to log in, then back here.
    const next = `/api/checkout/continue?plan=${plan}&billing=${billing}`;
    return NextResponse.redirect(
      `${origin}/login?next=${encodeURIComponent(next)}`
    );
  }

  if (!CHECKOUT_PLANS.includes(plan) || !CHECKOUT_BILLINGS.includes(billing)) {
    return NextResponse.redirect(`${origin}/pricing`);
  }

  try {
    const result = await startCheckoutSession({
      userId: session.user.id,
      userEmail: session.user.email,
      plan,
      billing,
      origin,
    });
    if (result.kind === "alreadyActive") {
      return NextResponse.redirect(`${origin}/explore?checkout=already`);
    }
    return NextResponse.redirect(result.url);
  } catch (error) {
    console.error("Failed to continue checkout after sign-in", error);
    return NextResponse.redirect(`${origin}/pricing?checkout=error`);
  }
}
