import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getTeamForUser, revokeInvite } from "@/lib/teams-db";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * DELETE `/api/team/invites/[id]` — revokes a pending invite. Allowed for
 * the team owner or whoever sent the invite; the invite must belong to
 * the caller's team.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid invite id" }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const team = await getTeamForUser(admin, session.user.id);

    if (!team) {
      return NextResponse.json({ error: "You're not in a team" }, { status: 404 });
    }

    const invite = team.pendingInvites.find((row) => row.id === id);
    if (!invite) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    const mayRevoke =
      team.viewerRole === "owner" || invite.invitedByUserId === session.user.id;
    if (!mayRevoke) {
      return NextResponse.json(
        { error: "Only the owner or the inviter can revoke an invite" },
        { status: 403 }
      );
    }

    await revokeInvite(admin, team.id, id);

    const fresh = await getTeamForUser(admin, session.user.id);
    return NextResponse.json({ team: fresh });
  } catch (error) {
    console.error("Failed to revoke invite", error);
    return NextResponse.json(
      { error: "Failed to revoke invite" },
      { status: 500 }
    );
  }
}
