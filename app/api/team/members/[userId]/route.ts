import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  getTeamForUser,
  recordRemovalNotice,
  removeMember
} from "@/lib/teams-db";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = { params: Promise<{ userId: string }> };

/**
 * DELETE `/api/team/members/[userId]` — owner removes a member. The owner
 * row can't be removed this way (leaving/deleting the team is handled by
 * `/api/team/leave`).
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  const { userId } = await context.params;
  if (!UUID_PATTERN.test(userId)) {
    return NextResponse.json({ error: "Invalid member id" }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const team = await getTeamForUser(admin, session.user.id);

    if (!team) {
      return NextResponse.json({ error: "You're not in a team" }, { status: 404 });
    }
    if (team.viewerRole !== "owner") {
      return NextResponse.json(
        { error: "Only the owner can remove members" },
        { status: 403 }
      );
    }

    const target = team.members.find((member) => member.userId === userId);
    if (!target) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    if (target.role === "owner") {
      return NextResponse.json(
        { error: "The owner can't be removed — leave the team instead" },
        { status: 400 }
      );
    }

    await removeMember(admin, team.id, userId);

    // Leave a one-time notice so the removed member is told on next login
    // (their membership row is gone, so there's nothing else to derive it
    // from). Best-effort — removal already succeeded.
    try {
      await recordRemovalNotice(admin, userId, team.name);
    } catch (err) {
      console.error("Failed to record removal notice", err);
    }

    const fresh = await getTeamForUser(admin, session.user.id);
    return NextResponse.json({ team: fresh });
  } catch (error) {
    console.error("Failed to remove member", error);
    return NextResponse.json(
      { error: "Failed to remove member" },
      { status: 500 }
    );
  }
}
