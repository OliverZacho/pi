import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getBillingGraceStatus } from "@/lib/billing-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET `/api/billing/status` — lightweight billing state for the signed-in
 * user, read from their own `subscriptions` row (RLS self-select). Currently
 * surfaces just the dunning grace window so the in-app reminder card knows
 * whether (and until when) to nudge a `past_due` user to fix their card.
 *
 * The app sidebar now resolves this server-side via {@link getBillingGraceStatus}
 * and seeds `BillingGraceCard` directly, so this route is only the
 * client-fetch fallback for surfaces that don't pass the server value.
 */
export async function GET() {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  return NextResponse.json(
    await getBillingGraceStatus(session.supabase, session.user.id)
  );
}
