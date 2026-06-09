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

function mapRow(row: BrandRequestRow): BrandRequest {
  return {
    id: row.id,
    companyName: row.company_name,
    website: row.website,
    status: row.status,
    createdAt: row.created_at,
    handledAt: row.handled_at
  };
}

/**
 * Persists a visitor's "add this brand" request. Called from the public
 * route with a service-role client so logged-out visitors can submit.
 */
export async function createBrandRequestInDb(
  supabase: PirolDb,
  input: { companyName: string; website: string }
): Promise<BrandRequest> {
  const { data, error } = await supabase
    .from("brand_requests")
    .insert({ company_name: input.companyName, website: input.website })
    .select("id, company_name, website, status, created_at, handled_at")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to insert brand request");
  }
  return mapRow(data);
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
