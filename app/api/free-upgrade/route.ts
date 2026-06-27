import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { PlanId } from "@/lib/stripe";
import { grantTestWindow, stampPlanSelected } from "@/lib/plan-selection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PLANS: PlanId[] = ["solo", "team"];

/**
 * POST `/api/free-upgrade` — TEMPORARY launch bridge for the external-test
 * window. Any signed-in user can flip themselves to an active Solo/Team
 * entitlement for free, time-boxed to two weeks. No Stripe involved (see
 * {@link grantTestWindow}). We also stamp `plan_selected_at` so anyone who
 * upgrades here isn't later re-prompted by the onboarding plan modal.
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
    await grantTestWindow(admin, session.user.id, plan);
    await stampPlanSelected(admin, session.user.id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to grant free upgrade", error);
    return NextResponse.json(
      { error: "Could not complete upgrade" },
      { status: 500 }
    );
  }
}
