import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

type PirolDb = SupabaseClient<Database>;

export type BrandRequest = {
  id: string;
  companyName: string;
  website: string;
  status: string;
  createdAt: string;
  handledAt: string | null;
};

export const MAX_BRAND_REQUEST_FIELD = 200;

type BrandRequestRow = Database["public"]["Tables"]["brand_requests"]["Row"];

// Queries select the public shape only; `requested_by` stays internal
// to the notification lookup and is never echoed back out.
function mapRow(row: Omit<BrandRequestRow, "requested_by">): BrandRequest {
  return {
    id: row.id,
    companyName: row.company_name,
    website: row.website,
    status: row.status,
    createdAt: row.created_at,
    handledAt: row.handled_at
  };
}

// Inserts are written by the `record_brand_request` SECURITY DEFINER function
// (see the public /api/brand-requests route), not from here — so no
// service-role insert helper lives in this module.

/**
 * Handled requests the user submitted, newest first — feeds the sidebar
 * "<Brand> was added" notice. "Handled" includes operator-dismissed
 * requests, so the caller cross-checks against `companies` and only
 * notifies when a matching brand actually exists in the archive.
 */
export async function listHandledBrandRequestsForUser(
  supabase: PirolDb,
  userId: string,
  options: { limit?: number } = {}
): Promise<BrandRequest[]> {
  const { limit = 5 } = options;
  const { data, error } = await supabase
    .from("brand_requests")
    .select("id, company_name, website, status, created_at, handled_at")
    .eq("requested_by", userId)
    .eq("status", "handled")
    .order("handled_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }
  return (data ?? []).map(mapRow);
}

/**
 * Lists brand requests for the admin triage block, newest first. Defaults to
 * pending so handled requests drop out of the operator's queue.
 */
export async function listBrandRequestsInDb(
  supabase: PirolDb,
  options: { status?: string; limit?: number } = {}
): Promise<BrandRequest[]> {
  const { status = "pending", limit = 100 } = options;
  const { data, error } = await supabase
    .from("brand_requests")
    .select("id, company_name, website, status, created_at, handled_at")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }
  return (data ?? []).map(mapRow);
}

/**
 * Marks a request handled (operator created the subscription, or dismissed
 * it) and stamps `handled_at`.
 */
export async function markBrandRequestHandledInDb(
  supabase: PirolDb,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("brand_requests")
    .update({ status: "handled", handled_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    throw error;
  }
}
