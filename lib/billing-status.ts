import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

export type BillingGraceStatus = {
  inGrace: boolean;
  graceEndsAt: string | null;
};

/**
 * Dunning-grace state for a user, read from their own `subscriptions` row
 * (RLS self-select). Shared by the `/api/billing/status` route and the
 * server-rendered sidebar so the grace nudge can be resolved once on the
 * server instead of via a per-page client round-trip.
 */
export async function getBillingGraceStatus(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<BillingGraceStatus> {
  const { data } = await supabase
    .from("subscriptions")
    .select("status, grace_until")
    .eq("user_id", userId)
    .maybeSingle();

  const inGrace =
    data?.status === "past_due" &&
    !!data.grace_until &&
    new Date(data.grace_until).getTime() > Date.now();

  return { inGrace, graceEndsAt: inGrace ? data!.grace_until : null };
}
