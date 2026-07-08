import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { stampPlanSelected } from "@/lib/plan-selection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST `/api/select-plan` — records that a new signup picked "Free" in the
 * forced "pick a plan" modal on /explore. Stamps `plan_selected_at` so the
 * modal stops showing; the user stays on the free preview tier.
 *
 * Paid plans (Solo/Team) do NOT come here — they hand off to Stripe Checkout
 * via `/api/checkout` directly from the modal.
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

  if (body.plan !== "free") {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    await stampPlanSelected(admin, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to record plan choice", error);
    return NextResponse.json(
      { error: "Could not save your choice" },
      { status: 500 }
    );
  }
}
