import { NextResponse } from "next/server";
import { isConsumerEmailDomain } from "@/lib/email-domains";
import { getProfile } from "@/lib/profile-db";
import { requireSession } from "@/lib/require-admin-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  addMember,
  countTeamSeats,
  createPendingInvite,
  deleteInvite,
  ensureTeamForUser,
  findUserIdByEmail,
  getTeamForUser,
  hasActiveTeamPlan,
  TEAM_SEAT_LIMIT
} from "@/lib/teams-db";

const EMAIL_SHAPE = /.+@.+\..+/;

/**
 * POST `/api/team/invites` `{ email }` — invites someone to the caller's
 * team (created on first invite, caller becomes owner).
 *
 * Sending invites requires an active "team" plan (admins bypass). When
 * the inviter's email is on a company domain, invitees must share it;
 * consumer domains (gmail etc.) carry no such signal, so those inviters
 * can invite any address.
 *
 * Existing users are added immediately (`outcome: "added"`). Unknown
 * emails get a pending invite row plus a Supabase auth invite email — the
 * magic link signs them up, and the auth callback claims the invite by
 * email match (`outcome: "invited"`).
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if ("response" in session) {
    return session.response;
  }

  // Plan gate. Both reads go through the session client (admin_users and
  // subscriptions are self-readable under RLS).
  const [{ data: adminRow }, teamPlan] = await Promise.all([
    session.supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle(),
    hasActiveTeamPlan(session.supabase, session.user.id)
  ]);

  if (!adminRow && !teamPlan) {
    return NextResponse.json(
      {
        error: "Inviting teammates requires the Team plan.",
        code: "TEAM_PLAN_REQUIRED"
      },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawEmail =
    body && typeof body === "object" && "email" in body
      ? (body as { email: unknown }).email
      : undefined;

  if (typeof rawEmail !== "string" || !EMAIL_SHAPE.test(rawEmail.trim())) {
    return NextResponse.json(
      { error: "Enter a valid email address" },
      { status: 400 }
    );
  }

  const email = rawEmail.trim().toLowerCase();
  const viewerEmail = (session.user.email ?? "").toLowerCase();
  const emailDomain = viewerEmail.includes("@") ? viewerEmail.split("@")[1] : "";

  if (!emailDomain) {
    return NextResponse.json(
      { error: "Your account has no email domain to invite against" },
      { status: 400 }
    );
  }
  if (email === viewerEmail) {
    return NextResponse.json({ error: "That's your own email" }, { status: 400 });
  }

  const domainRestricted = !isConsumerEmailDomain(emailDomain);
  if (domainRestricted && email.split("@")[1] !== emailDomain) {
    return NextResponse.json(
      { error: `Invites are restricted to @${emailDomain} addresses` },
      { status: 400 }
    );
  }

  try {
    const admin = getSupabaseAdmin();

    // Company teams are named after the domain; for consumer domains
    // that would be "gmail.com", so name those after the inviter.
    let defaultTeamName = emailDomain;
    if (!domainRestricted) {
      const profile = await getProfile(session.supabase, session.user.id).catch(
        () => null
      );
      const inviterName = profile?.fullName?.trim() || viewerEmail.split("@")[0];
      defaultTeamName = `${inviterName}'s team`;
    }

    const { teamId } = await ensureTeamForUser(
      admin,
      session.user.id,
      defaultTeamName
    );

    // Seat cap: owner + 5 invitees. Counted against members + pending
    // invites so a fully-invited team can't overshoot before sign-ups land.
    const seats = await countTeamSeats(admin, teamId);
    if (seats >= TEAM_SEAT_LIMIT) {
      return NextResponse.json(
        {
          error: `Your team is full (${TEAM_SEAT_LIMIT} seats). Remove a member or revoke an invite to free a seat.`,
          code: "TEAM_FULL"
        },
        { status: 409 }
      );
    }

    const existingUserId = await findUserIdByEmail(admin, email);

    if (existingUserId) {
      const outcome = await addMember(admin, teamId, existingUserId);
      if (outcome === "already_in_team") {
        return NextResponse.json(
          { error: "That person is already in a team" },
          { status: 409 }
        );
      }

      const team = await getTeamForUser(admin, session.user.id);
      return NextResponse.json({ team, outcome: "added" });
    }

    const invite = await createPendingInvite(
      admin,
      teamId,
      email,
      session.user.id
    );
    if (invite === "duplicate") {
      return NextResponse.json(
        { error: "An invite for that email is already pending" },
        { status: 409 }
      );
    }

    const { origin } = new URL(request.url);
    const { error: sendError } = await admin.auth.admin.inviteUserByEmail(
      email,
      // `next` is only the fallback — when the callback actually claims the
      // invite it overrides to /explore?team_welcome=1 (the welcome modal).
      { redirectTo: `${origin}/auth/callback?next=/explore` }
    );

    if (sendError) {
      // Roll back so a retry isn't blocked by the pending-unique index.
      await deleteInvite(admin, invite.id);
      console.error("Failed to send invite email", sendError);
      return NextResponse.json(
        { error: "Couldn't send the invite email" },
        { status: 502 }
      );
    }

    const team = await getTeamForUser(admin, session.user.id);
    return NextResponse.json({ team, outcome: "invited" }, { status: 201 });
  } catch (error) {
    console.error("Failed to send invite", error);
    return NextResponse.json(
      { error: "Failed to send invite" },
      { status: 500 }
    );
  }
}
