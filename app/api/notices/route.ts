import { NextResponse } from "next/server";
import { getViewer } from "@/lib/access";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { listSidebarNotices } from "@/lib/sidebar-notices";

/**
 * GET `/api/notices` — prioritized sidebar-footer notices for the
 * signed-in viewer (save-cap usage, fulfilled brand requests, team
 * joins, followed-brand activity). The sidebar fetches this once per
 * mount; dismissals are client-side, so the route stays read-only.
 *
 * Reads go through the service-role client because several sources
 * (teams, brand requests, free-tier saves) are RLS-locked to
 * service_role — the viewer is authenticated here first.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.json({ notices: [] });
  }

  try {
    const notices = await listSidebarNotices(getSupabaseAdmin(), viewer);
    return NextResponse.json(
      { notices },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Failed to build sidebar notices", error);
    return NextResponse.json({ notices: [] }, { status: 200 });
  }
}
