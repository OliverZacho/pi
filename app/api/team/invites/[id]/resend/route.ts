import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  getTeamForUser,
  markInviteResent,
  INVITE_RESEND_COOLDOWN_MS,
  INVITE_RESEND_LIMIT
} from "@/lib/teams-db";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST `/api/team/invites/[id]/resend` — re-sends the auth invite email for
 * a pending invite. Allowed for the team owner or whoever sent the invite.
 *
 * Rate-limited server-side so the caps hold across reloads and devices: at
 * most one resend per `INVITE_RESEND_COOLDOWN_MS` (429) and no more than
 * `INVITE_RESEND_LIMIT` resends total (409). The counter is only bumped
 * after the email actually sends.
 */
export async function POST(request: Request, context: RouteContext) {
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

    const mayResend =
      team.viewerRole === "owner" || invite.invitedByUserId === session.user.id;
    if (!mayResend) {
      return NextResponse.json(
        { error: "Only the owner or the inviter can resend an invite" },
        { status: 403 }
      );
    }

    if (invite.resendCount >= INVITE_RESEND_LIMIT) {
      return NextResponse.json(
        {
          error: "You've resent this invite the maximum number of times.",
          code: "RESEND_LIMIT"
        },
        { status: 409 }
      );
    }

    const elapsed = Date.now() - new Date(invite.lastSentAt).getTime();
    if (elapsed < INVITE_RESEND_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil(
        (INVITE_RESEND_COOLDOWN_MS - elapsed) / 1000
      );
      return NextResponse.json(
        {
          error: `Please wait ${retryAfterSeconds}s before resending.`,
          code: "RESEND_COOLDOWN",
          retryAfterSeconds
        },
        { status: 429 }
      );
    }

    const { origin } = new URL(request.url);
    const { error: sendError } = await admin.auth.admin.inviteUserByEmail(
      invite.email,
      { redirectTo: `${origin}/auth/callback?next=/settings` }
    );

    if (sendError) {
      console.error("Failed to resend invite email", sendError);
      return NextResponse.json(
        { error: "Couldn't resend the invite email" },
        { status: 502 }
      );
    }

    await markInviteResent(admin, id);

    const fresh = await getTeamForUser(admin, session.user.id);
    return NextResponse.json({ team: fresh });
  } catch (error) {
    console.error("Failed to resend invite", error);
    return NextResponse.json(
      { error: "Failed to resend invite" },
      { status: 500 }
    );
  }
}
