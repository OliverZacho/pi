import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getTeamForUser, removeMember } from "@/lib/teams-db";

/**
 * POST `/api/team/leave` — the caller leaves their team. A plain member
 * just drops their row. The sole owner deletes the team (cascades members
 * and pending invites). An owner with other members must remove them
 * first — account deletion is the only auto-promotion path.
 */
export async function POST() {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  try {
    const admin = getSupabaseAdmin();
    const team = await getTeamForUser(admin, session.user.id);

    if (!team) {
      return NextResponse.json({ error: "You're not in a team" }, { status: 404 });
    }

    if (team.viewerRole === "owner") {
      if (team.members.length > 1) {
        return NextResponse.json(
          { error: "Remove the other members before leaving the team" },
          { status: 409 }
        );
      }

      const { error } = await admin.from("teams").delete().eq("id", team.id);
      if (error) {
        throw new Error(`Failed to delete team: ${error.message}`);
      }
      return NextResponse.json({ ok: true });
    }

    await removeMember(admin, team.id, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to leave team", error);
    return NextResponse.json({ error: "Failed to leave team" }, { status: 500 });
  }
}
