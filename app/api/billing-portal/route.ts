import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Absolute origin for the portal return URL, honouring proxy headers. */
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
 * POST `/api/billing-portal` — open Stripe's hosted billing portal so a paying
 * user can update their card, switch plan, or cancel. We read their
 * `stripe_customer_id` from their own `subscriptions` row (RLS allows
 * self-select), so this only works for someone who has been through checkout.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  const { data: row } = await session.supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!row?.stripe_customer_id) {
    return NextResponse.json(
      { error: "No billing account yet" },
      { status: 404 }
    );
  }

  try {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${originOf(request)}/settings`,
    });
    return NextResponse.json({ url: portal.url });
  } catch (error) {
    console.error("Failed to create billing portal session", error);
    return NextResponse.json(
      { error: "Failed to open billing portal" },
      { status: 500 }
    );
  }
}
