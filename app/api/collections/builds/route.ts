import { NextResponse } from "next/server";
import { requireSessionWithEntitlement } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET `/api/collections/builds` — ids of the viewer's own smart
 * collections whose matches are still building. The sidebar polls this
 * only while it knows of a running build, and announces each one that
 * drops off the list as ready.
 */
export async function GET() {
  const session = await requireSessionWithEntitlement();
  if ("response" in session) return session.response;

  const { data, error } = await getSupabaseAdmin()
    .from("collections")
    .select("id, collection_match_builds!inner(status)")
    .eq("user_id", session.user.id)
    .eq("collection_match_builds.status", "building");
  if (error) {
    console.error("Failed to list collection builds", error);
    return NextResponse.json({ error: "Failed to list builds" }, { status: 500 });
  }
  return NextResponse.json(
    { building: (data ?? []).map((row) => row.id) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
