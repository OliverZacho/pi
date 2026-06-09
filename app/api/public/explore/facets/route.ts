import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getExploreFacets } from "@/lib/explore-db";

/**
 * Public (no-auth) mirror of `/api/explore/facets`, so the logged-out
 * Explore teaser can populate its brand / market / category filter chips.
 * Reads via the service-role client since RLS would return nothing for an
 * anonymous request.
 */
export async function GET() {
  try {
    const facets = await getExploreFacets(getSupabaseAdmin());
    return NextResponse.json(facets);
  } catch (error) {
    console.error("Failed to load public Explore facets", error);
    return NextResponse.json(
      { error: "Failed to load Explore facets" },
      { status: 500 }
    );
  }
}
