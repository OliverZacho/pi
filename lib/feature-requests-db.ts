import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

type PirolDb = SupabaseClient<Database>;

export type FeatureRequest = {
  id: string;
  message: string;
  requesterEmail: string | null;
  status: string;
  createdAt: string;
  handledAt: string | null;
};

export const MAX_FEATURE_REQUEST_MESSAGE = 2000;

type FeatureRequestRow = Database["public"]["Tables"]["feature_requests"]["Row"];

// `requested_by` stays internal; the admin UI only needs the email + message.
function mapRow(
  row: Omit<FeatureRequestRow, "requested_by">
): FeatureRequest {
  return {
    id: row.id,
    message: row.message,
    requesterEmail: row.requester_email,
    status: row.status,
    createdAt: row.created_at,
    handledAt: row.handled_at
  };
}

const SELECT_COLUMNS =
  "id, message, requester_email, status, created_at, handled_at";

// Inserts are written by the `record_feature_request` SECURITY DEFINER
// function (see the public /api/feature-requests route), not from here — so no
// service-role insert helper lives in this module.

/**
 * Lists feature requests for the admin Feedback tab, newest first. Defaults
 * to pending so handled requests drop out of the operator's queue.
 */
export async function listFeatureRequestsInDb(
  supabase: PirolDb,
  options: { status?: string; limit?: number } = {}
): Promise<FeatureRequest[]> {
  const { status = "pending", limit = 100 } = options;
  const { data, error } = await supabase
    .from("feature_requests")
    .select(SELECT_COLUMNS)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }
  return (data ?? []).map(mapRow);
}

/**
 * Marks a request handled (operator actioned or dismissed it) and stamps
 * `handled_at`.
 */
export async function markFeatureRequestHandledInDb(
  supabase: PirolDb,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("feature_requests")
    .update({ status: "handled", handled_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    throw error;
  }
}
