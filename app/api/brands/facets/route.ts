import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";
import { getBrandsFacets } from "@/lib/brands-explore-db";

/**
 * Returns every market currently in use across the (non-deleted)
 * companies plus a couple of headline counters the page header uses.
 * Cheap enough to call on page load; the client caches it in state.
 */
export async function GET() {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const facets = await getBrandsFacets(session.supabase);
    return NextResponse.json(facets);
  } catch (error) {
    console.error("Failed to load Brands facets", error);
    return NextResponse.json(
      { error: "Failed to load Brands facets" },
      { status: 500 }
    );
  }
}
