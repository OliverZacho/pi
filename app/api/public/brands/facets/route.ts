import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getBrandsFacets } from "@/lib/brands-explore-db";

/**
 * Public (no-auth) mirror of `/api/brands/facets` for the browsable
 * directory. Reads via the service-role client since RLS would return
 * nothing for an anonymous request.
 */
export async function GET() {
  try {
    const facets = await getBrandsFacets(getSupabaseAdmin());
    return NextResponse.json(facets);
  } catch (error) {
    console.error("Failed to load public Brands facets", error);
    return NextResponse.json(
      { error: "Failed to load Brands facets" },
      { status: 500 }
    );
  }
}
