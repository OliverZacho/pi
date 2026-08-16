import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { trialEligible, TRIAL_PERIOD_DAYS } from "@/lib/trial";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET `/api/billing/status` — lightweight billing state for the signed-in
 * user, read from their own `subscriptions` row (RLS self-select). Surfaces
 * the dunning grace window, so the in-app reminder card knows whether (and
 * until when) to nudge a `past_due` user to fix their card, plus whether the
 * one free trial is still available, so upgrade CTAs can label themselves
 * honestly. Eligibility runs through the same `trialEligible` predicate
 * checkout uses, so the button can never promise a trial checkout won't give.
 */
export async function GET() {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  const { data } = await session.supabase
    .from("subscriptions")
    .select("status, grace_until, trial_started_at, stripe_subscription_id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  const inGrace =
    data?.status === "past_due" &&
    !!data.grace_until &&
    new Date(data.grace_until).getTime() > Date.now();

  return NextResponse.json({
    inGrace,
    graceEndsAt: inGrace ? data!.grace_until : null,
    trialEligible: trialEligible("solo", data ?? null),
    trialDays: TRIAL_PERIOD_DAYS,
  });
}
