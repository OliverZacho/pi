import type { PlanId } from "@/lib/stripe";
import type { PirolSupabaseClient } from "@/lib/supabase-admin";

/** How long a free test-window grant lasts — the two-week external-test window. */
const WINDOW_DAYS = 14;

/**
 * When a test-window grant lapses: now + the window. Stamped onto
 * `current_period_end`, which `has_archive_access()` already enforces, so the
 * grant self-expires with zero cleanup.
 */
export function testWindowEnd(): string {
  return new Date(Date.now() + WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Record that the user has made their onboarding plan choice. Once stamped,
 * the forced "pick a plan" modal on /explore never shows again. Requires the
 * service-role client (writes past the user's own RLS, and the upgrade flows
 * already run service-side).
 */
export async function stampPlanSelected(
  admin: PirolSupabaseClient,
  userId: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("user_profiles")
    .update({ plan_selected_at: now, updated_at: now })
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * Record that the user has finished (or skipped) the onboarding product tour.
 * Once stamped, the guided walkthrough never auto-starts again. Like
 * {@link stampPlanSelected} this needs the service-role client. The tour only
 * auto-starts when this and `plan_selected_at` are both null, so existing
 * (already plan-stamped) users are never prompted.
 */
export async function stampTourCompleted(
  admin: PirolSupabaseClient,
  userId: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("user_profiles")
    .update({ tour_completed_at: now, updated_at: now })
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * TEMPORARY launch bridge: grant a free, time-boxed Solo/Team entitlement for
 * the external-test window. No Stripe involved — upsert an `active`
 * subscription row (with no `stripe_subscription_id`); the existing entitlement
 * check does the rest, and the grant self-expires at `current_period_end`.
 *
 * Revert this (and its callers) once Stripe checkout is live.
 */
export async function grantTestWindow(
  admin: PirolSupabaseClient,
  userId: string,
  plan: PlanId
): Promise<void> {
  const { error } = await admin.from("subscriptions").upsert(
    {
      user_id: userId,
      status: "active",
      plan,
      current_period_end: testWindowEnd(),
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}
