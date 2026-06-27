import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { PlanId } from "@/lib/stripe";
import { grantTestWindow, stampPlanSelected } from "@/lib/plan-selection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAID: PlanId[] = ["solo", "team"];
const CHOICES = ["free", "solo", "team"];

/**
 * POST `/api/select-plan` — records the onboarding plan choice made in the
 * forced "pick a plan" modal shown to new signups on /explore.
 *
 *  - "free": just stamp `plan_selected_at` so the modal stops showing; the user
 *    stays on the free preview tier.
 *  - "solo" / "team": TEMPORARY test-window path — grant the entitlement for
 *    free (see {@link grantTestWindow}) and stamp the choice. At launch this
 *    paid branch is swapped for real Stripe embedded checkout.
 *
 * The response `redirect` tells the client where to go on success (paid plans
 * bounce through /explore?upgraded=1 to refresh entitlement; free just closes
 * the modal in place).
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

  const plan = body.plan ?? "";
  if (!CHOICES.includes(plan)) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const isPaid = PAID.includes(plan as PlanId);
    if (isPaid) {
      await grantTestWindow(admin, session.user.id, plan as PlanId);
    }
    await stampPlanSelected(admin, session.user.id);

    return NextResponse.json({
      ok: true,
      redirect: isPaid ? "/explore?upgraded=1" : null
    });
  } catch (error) {
    console.error("Failed to record plan choice", error);
    return NextResponse.json(
      { error: "Could not save your choice" },
      { status: 500 }
    );
  }
}
