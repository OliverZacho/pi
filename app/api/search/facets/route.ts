import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getSearchFacets } from "@/lib/explore-db";

/**
 * Public taxonomy for the marketing header search overlay's browse view:
 * popular brands, categories (markets) and regions. Unlike `/api/explore/
 * facets`, this:
 *   - is unauthenticated — the marketing search is visible to logged-out
 *     visitors, so gating it behind archive access left the overlay empty
 *     for everyone who isn't a paying subscriber;
 *   - reads only the small `companies` table via the service-role client
 *     (companies aren't readable under RLS — same pattern the public brand
 *     pages use), instead of scanning tens of thousands of `captured_emails`;
 *   - is CDN-cached, since the brand taxonomy changes slowly.
 *
 * Content types and ESP providers are fixed enums the client renders
 * statically, so they're deliberately not returned here.
 */
export async function GET() {
  try {
    const facets = await getSearchFacets(getSupabaseAdmin());
    return NextResponse.json(facets, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"
      }
    });
  } catch (error) {
    // Log the concrete message/code, not the raw object: a PostgrestError's
    // fields are non-enumerable, so the structured JSON logger serialises it
    // to a useless `{}`. Spell out what actually failed.
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null
          ? JSON.stringify({
              message: (error as { message?: unknown }).message,
              code: (error as { code?: unknown }).code,
              details: (error as { details?: unknown }).details,
              hint: (error as { hint?: unknown }).hint
            })
          : String(error);
    console.error(`Failed to load search facets: ${detail}`);
    return NextResponse.json(
      { error: "Failed to load search facets" },
      { status: 500 }
    );
  }
}
