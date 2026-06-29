import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { stampTourCompleted } from "@/lib/plan-selection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST `/api/complete-tour` — records that the new signup finished or skipped
 * the onboarding product tour. Stamps `tour_completed_at` so the walkthrough
 * never auto-starts again; the forced "pick a plan" modal then takes over on
 * the next /explore render (see {@link stampTourCompleted}).
 */
export async function POST() {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const admin = getSupabaseAdmin();
    await stampTourCompleted(admin, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to record tour completion", error);
    return NextResponse.json(
      { error: "Could not record tour completion" },
      { status: 500 }
    );
  }
}
