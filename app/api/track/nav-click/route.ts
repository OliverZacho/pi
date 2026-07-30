import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidNavId } from "@/lib/nav-clicks-db";

/**
 * Records a click on a primary left-panel nav button. Called (fire-and-forget,
 * via `navigator.sendBeacon`) by `ExploreSidebar` before it navigates.
 *
 * The write goes through the `record_nav_click` SECURITY DEFINER function via
 * the ordinary cookie-scoped client — deliberately NOT the service role. This
 * route holds no elevated credential: the function is the only write path, it
 * can only insert into `nav_clicks`, and it stamps the caller's own auth.uid().
 * Mirrors app/api/track/upgrade-click/route.ts.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const record = (body ?? {}) as Record<string, unknown>;
  // Cheap pre-check so obvious junk never hits the DB; the function re-validates.
  if (!isValidNavId(record.navId)) {
    return NextResponse.json({ error: "Invalid navId" }, { status: 400 });
  }
  const path =
    typeof record.path === "string" ? record.path.slice(0, 512) : null;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_nav_click", {
      p_nav_id: record.navId,
      p_path: path ?? undefined
    });
    if (error) throw error;
  } catch (error) {
    console.error("Failed to record nav click", error);
    return NextResponse.json({ error: "Failed to record" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
