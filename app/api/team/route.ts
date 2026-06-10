import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getTeamForUser } from "@/lib/teams-db";

/**
 * GET `/api/team` — the caller's team (members + pending invites), or
 * null when they aren't in one. Initial render is server-fetched by the
 * settings page; this exists for client-side refresh after mutations.
 */
export async function GET() {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const team = await getTeamForUser(getSupabaseAdmin(), session.user.id);
    return NextResponse.json({ team });
  } catch (error) {
    console.error("Failed to load team", error);
    return NextResponse.json({ error: "Failed to load team" }, { status: 500 });
  }
}
