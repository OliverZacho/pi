import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidUpgradeSource } from "@/lib/upgrade-clicks-db";

/**
 * Records a click on an upgrade / subscribe CTA. Called (fire-and-forget, via
 * `navigator.sendBeacon`) by `<TrackedUpgradeLink>` before it navigates to
 * `/pricing`. Open to logged-out visitors.
 *
 * The write goes through the `record_upgrade_click` SECURITY DEFINER function
 * via the ordinary cookie-scoped client — deliberately NOT the service role.
 * This route is unauthenticated and internet-facing, so it holds no elevated
 * credential: the function is the only write path, it can only insert into
 * `upgrade_clicks`, and it stamps the caller's own `auth.uid()`.
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
  if (!isValidUpgradeSource(record.source)) {
    return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  }
  const path =
    typeof record.path === "string" ? record.path.slice(0, 512) : null;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_upgrade_click", {
      p_source: record.source,
      p_path: path ?? undefined
    });
    if (error) throw error;
  } catch (error) {
    console.error("Failed to record upgrade click", error);
    return NextResponse.json({ error: "Failed to record" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
