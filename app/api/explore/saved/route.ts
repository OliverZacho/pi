import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
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
 *
 * Open to any signed-in user. Free (non-entitled) users read through the
 * service-role client and are scoped to curated emails only, so the
 * endpoint never leaks paywalled archive content they may have saved
 * while previously subscribed.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  const { data: hasAccess } = await session.supabase.rpc("has_archive_access");
  const entitled = Boolean(hasAccess);
  const client = entitled ? session.supabase : getSupabaseAdmin();
  const curatedOnly = !entitled;

  const url = new URL(request.url);

  try {
    if (url.searchParams.get("ids") === "1") {
      const set = await listSavedEmailIds(client, session.user.id, null, {
        curatedOnly
      });
      return NextResponse.json({ ids: Array.from(set) });
    }

    const result = await listSavedEmails(client, session.user.id, {
      curatedOnly
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to list saved emails", error);
    return NextResponse.json(
      { error: "Failed to list saved emails" },
      { status: 500 }
    );
  }
}
