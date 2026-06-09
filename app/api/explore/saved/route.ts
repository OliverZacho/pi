import { NextResponse } from "next/server";
import { requireArchiveAccess } from "@/lib/require-admin-api";
import { listSavedEmails, listSavedEmailIds } from "@/lib/saved-emails-db";

/**
 * GET `/api/explore/saved`
 *
 * Two response shapes share this route to avoid spawning a second
 * endpoint for what is really the same data with different projections:
 *
 *   • Default: returns the full saved gallery — `ExploreEmailCard[]` ordered
 *     by `saved_at` desc, ready to render in the grid.
 *   • `?ids=1`: returns just the bookmark id set as `{ ids: string[] }`,
 *     used by the Explore page to render the "Saved" toggle state on
 *     each card.
 */
export async function GET(request: Request) {
  const session = await requireArchiveAccess();
  if ("response" in session) {
    return session.response;
  }

  const url = new URL(request.url);

  try {
    if (url.searchParams.get("ids") === "1") {
      const set = await listSavedEmailIds(session.supabase, session.user.id);
      return NextResponse.json({ ids: Array.from(set) });
    }

    const result = await listSavedEmails(session.supabase, session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to list saved emails", error);
    return NextResponse.json(
      { error: "Failed to list saved emails" },
      { status: 500 }
    );
  }
}
