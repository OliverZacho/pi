import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin-api";
import { getExploreFacets } from "@/lib/explore-db";

/**
 * Returns every brand / market / category currently present across the
 * captured emails so the Explore filter dropdowns can list every option,
 * not just the ones in the currently-loaded page. Cheap enough to call
 * on page load; the client caches it in component state.
 */
export async function GET() {
  const session = await requireAdminSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const facets = await getExploreFacets(session.supabase);
    return NextResponse.json(facets);
  } catch (error) {
    console.error("Failed to load Explore facets", error);
    return NextResponse.json(
      { error: "Failed to load Explore facets" },
      { status: 500 }
    );
  }
}
