import type { PirolSupabaseClient } from "@/lib/supabase-admin";

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
 * Record that the user has finished (or skipped) the new-signup onboarding
 * modal, along with whatever answers they gave — skips persist partial
 * answers too. Once stamped, the modal never shows again. Service-role
 * client for the same reason as the stampers above. Deliberately does NOT
 * touch `tour_completed_at`: the tour is retired and the two columns stay
 * independent for historical data.
 */
export async function stampOnboardingCompleted(
  admin: PirolSupabaseClient,
  userId: string,
  answers: {
    role?: string | null;
    categories?: string[] | null;
    ownBrandDomain?: string | null;
  } = {}
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("user_profiles")
    .update({
      onboarding_completed_at: now,
      onboarding_role: answers.role ?? null,
      onboarding_categories: answers.categories?.length
        ? answers.categories
        : null,
      own_brand_domain: answers.ownBrandDomain ?? null,
      updated_at: now
    })
    .eq("user_id", userId);
  if (error) throw error;
}
