import { NextResponse } from "next/server";
import { requireSessionWithEntitlement } from "@/lib/require-admin-api";
import { getCollectionMatchBuild } from "@/lib/collections-db";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET `/api/collections/[id]/build` — progress of a smart collection's
 * match build, polled by the building screen. `{ build: null }` means the
 * matches are ready to load.
 */
export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSessionWithEntitlement();
  if ("response" in session) return session.response;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid collection id" }, { status: 400 });
  }

  // Access: paid viewers read through RLS (owner or team share); free
  // viewers' client is the service role, so pin it to their own rows.
  let access = session.client.from("collections").select("id").eq("id", id);
  if (!session.hasAccess) access = access.eq("user_id", session.user.id);
  const { data: row, error } = await access.maybeSingle();
  if (error) {
    console.error("Failed to check collection access", error);
    return NextResponse.json({ error: "Failed to load build" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  try {
    const build = await getCollectionMatchBuild(getSupabaseAdmin(), id);
    return NextResponse.json(
      { build },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Failed to load collection build", err);
    return NextResponse.json({ error: "Failed to load build" }, { status: 500 });
  }
}
