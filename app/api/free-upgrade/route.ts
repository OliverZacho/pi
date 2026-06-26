import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { PlanId } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PLANS: PlanId[] = ["solo", "team"];

/** How long a free grant lasts — the two-week external-test window. */
const WINDOW_DAYS = 14;

/**
 * When the granted access lapses: now + the test window. Stamped onto
 * `current_period_end`, which `has_archive_access()` already enforces, so the
 * grant self-expires with zero cleanup.
 */
function accessUntil(): string {
  return new Date(
    Date.now() + WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}

/**
 * POST `/api/free-upgrade` — TEMPORARY launch bridge for the external-test
 * window. Any signed-in user can flip themselves to an active Solo/Team
 * entitlement for free, time-boxed to two weeks. No Stripe involved: we upsert
 * an `active` subscription row (with no `stripe_subscription_id`) via the
 * service role, and the existing entitlement check does the rest.
 *
 * Revert this route + its client wiring (git revert) once Stripe checkout is
 * live; the real `/api/checkout` path is left fully intact.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  let body: { plan?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const plan = body.plan as PlanId;
  if (!PLANS.includes(plan)) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from("subscriptions").upsert(
      {
        user_id: session.user.id,
        status: "active",
        plan,
        current_period_end: accessUntil(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to grant free upgrade", error);
    return NextResponse.json(
      { error: "Could not complete upgrade" },
      { status: 500 }
    );
  }
}
