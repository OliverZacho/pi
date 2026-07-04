import type { PirolSupabaseClient } from "./supabase-admin";

/**
 * Helpers for the Settings Team tab.
 *
 * Membership grants archive access: `has_archive_access()` (see
 * 20260621000000_team_entitlement.sql) returns true for any member of a
 * team whose owner holds an active "team" plan. A member's active/inactive
 * state is derived from the owner's subscription — never stored — so a
 * lapse drops access without deleting any data. The model is one team per
 * user (unique index on `team_members.user_id`); the first invite a user
 * sends creates their team with them as owner.
 *
 * Every function takes the service-role admin client: the team tables are
 * RLS'd to service_role only, and the API routes enforce ownership
 * explicitly. That avoids recursive `team_members` policies and keeps the
 * client-side surface zero.
 */

const UNIQUE_VIOLATION = "23505";

/**
 * Seats a team plan grants: the owner plus five invitees (6 total). Counted
 * against members + pending invites so a fully-invited team can't overshoot
 * even before the invitees sign up.
 */
export const TEAM_SEAT_LIMIT = 6;

/**
 * Resend throttling for pending invites. At most one resend per
 * `INVITE_RESEND_COOLDOWN_MS`, and no more than `INVITE_RESEND_LIMIT`
 * resends in total per invite. Enforced server-side (see the resend route)
 * so the limits survive reloads and other devices; the UI mirrors them for
 * the button state.
 */
export const INVITE_RESEND_COOLDOWN_MS = 60_000;
export const INVITE_RESEND_LIMIT = 3;

/** Seats currently consumed by a team: members + pending invites. */
export async function countTeamSeats(
  admin: PirolSupabaseClient,
  teamId: string
): Promise<number> {
  const [
    { count: memberCount, error: membersError },
    { count: inviteCount, error: invitesError }
  ] = await Promise.all([
    admin
      .from("team_members")
      .select("user_id", { count: "exact", head: true })
      .eq("team_id", teamId),
    admin
      .from("team_invites")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId)
      .eq("status", "pending")
  ]);

  if (membersError) {
    throw new Error(`Failed to count team members: ${membersError.message}`);
  }
  if (invitesError) {
    throw new Error(`Failed to count pending invites: ${invitesError.message}`);
  }

  return (memberCount ?? 0) + (inviteCount ?? 0);
}

/**
 * Whether the user has an active (or trialing, unexpired) subscription on
 * the "team" plan — the gate for *sending* invites. Unlike the other
 * helpers here this works with the caller's session client too: the
 * subscriptions table has a self-select RLS policy, so each user can read
 * their own row.
 *
 * Membership itself stays plan-agnostic (a member who never pays can sit
 * on someone else's team), and so does leaving/removing — only invite
 * creation checks this, so a downgraded owner can still wind a team down.
 */
export async function hasActiveTeamPlan(
  client: PirolSupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await client
    .from("subscriptions")
    .select("status, plan, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load subscription: ${error.message}`);
  }

  if (!data || data.plan !== "team") {
    return false;
  }
  if (data.status !== "active" && data.status !== "trialing") {
    return false;
  }
  return (
    data.current_period_end === null ||
    new Date(data.current_period_end).getTime() > Date.now()
  );
}

export type TeamMemberView = {
  userId: string;
  email: string;
  fullName: string | null;
  role: "owner" | "member";
  joinedAt: string;
};

export type PendingInviteView = {
  id: string;
  email: string;
  createdAt: string;
  invitedByUserId: string | null;
  /** How many times the invite email has been resent (0 on creation). */
  resendCount: number;
  /** ISO timestamp of the most recent send, coalesced to createdAt. */
  lastSentAt: string;
};

export type TeamView = {
  id: string;
  name: string;
  viewerRole: "owner" | "member";
  members: TeamMemberView[];
  pendingInvites: PendingInviteView[];
};

/**
 * The caller's team context as seen by entitlement: their role, the team
 * owner, and whether that owner currently holds an active "team" plan
 * (`ownerActive`). Backs the Settings billing/profile copy ("managed by …")
 * and the lapse interstitial. Sourced from the `get_team_context()` RPC,
 * which is SECURITY DEFINER but only returns the caller's own row.
 */
export type TeamContext = {
  teamId: string;
  teamName: string;
  role: "owner" | "member";
  ownerUserId: string;
  ownerName: string | null;
  /** Owner's "team" subscription is active/trialing or within grace. */
  ownerActive: boolean;
};

function asRole(role: string): "owner" | "member" {
  return role === "owner" ? "owner" : "member";
}

/**
 * Resolve the caller's team context via the `get_team_context()` RPC. Takes
 * the session client (the RPC keys off `auth.uid()`). Null when the caller
 * belongs to no team.
 */
export async function getTeamContext(
  client: PirolSupabaseClient
): Promise<TeamContext | null> {
  const { data, error } = await client.rpc("get_team_context");

  if (error) {
    throw new Error(`Failed to load team context: ${error.message}`);
  }

  const row = data?.[0];
  if (!row) {
    return null;
  }

  return {
    teamId: row.team_id,
    teamName: row.team_name,
    role: asRole(row.role),
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    ownerActive: row.owner_active
  };
}

/** The team the user belongs to, with members and pending invites. */
export async function getTeamForUser(
  admin: PirolSupabaseClient,
  userId: string
): Promise<TeamView | null> {
  const { data: membership, error: membershipError } = await admin
    .from("team_members")
    .select("team_id, role, teams ( id, name )")
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    throw new Error(`Failed to load team: ${membershipError.message}`);
  }

  if (!membership || !membership.teams) {
    return null;
  }

  const teamId = membership.team_id;

  const [{ data: memberRows, error: membersError }, { data: inviteRows, error: invitesError }] =
    await Promise.all([
      admin
        .from("team_members")
        .select("user_id, role, created_at")
        .eq("team_id", teamId)
        .order("created_at", { ascending: true }),
      admin
        .from("team_invites")
        .select("id, email, created_at, invited_by, resend_count, last_sent_at")
        .eq("team_id", teamId)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
    ]);

  if (membersError) {
    throw new Error(`Failed to load team members: ${membersError.message}`);
  }
  if (invitesError) {
    throw new Error(`Failed to load team invites: ${invitesError.message}`);
  }

  // Join members to user_profiles for name/email (kept in sync with
  // auth.users by trigger).
  const memberIds = (memberRows ?? []).map((row) => row.user_id);
  const { data: profileRows, error: profilesError } = memberIds.length
    ? await admin
        .from("user_profiles")
        .select("user_id, email, full_name")
        .in("user_id", memberIds)
    : { data: [], error: null };

  if (profilesError) {
    throw new Error(`Failed to load member profiles: ${profilesError.message}`);
  }

  const profilesById = new Map(
    (profileRows ?? []).map((row) => [row.user_id, row])
  );

  const members: TeamMemberView[] = (memberRows ?? []).map((row) => {
    const profile = profilesById.get(row.user_id);
    return {
      userId: row.user_id,
      email: profile?.email ?? "",
      fullName: profile?.full_name ?? null,
      role: asRole(row.role),
      joinedAt: row.created_at
    };
  });

  const pendingInvites: PendingInviteView[] = (inviteRows ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    invitedByUserId: row.invited_by,
    resendCount: row.resend_count ?? 0,
    lastSentAt: row.last_sent_at ?? row.created_at
  }));

  return {
    id: membership.teams.id,
    name: membership.teams.name,
    viewerRole: asRole(membership.role),
    members,
    pendingInvites
  };
}

/**
 * The team the user invites into, created on first use with the user as
 * owner. Returns the existing membership unchanged if they already belong
 * to a team (members can invite too).
 */
export async function ensureTeamForUser(
  admin: PirolSupabaseClient,
  userId: string,
  defaultName: string
): Promise<{ teamId: string; role: "owner" | "member" }> {
  const { data: existing, error: existingError } = await admin
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to load membership: ${existingError.message}`);
  }

  if (existing) {
    return { teamId: existing.team_id, role: asRole(existing.role) };
  }

  const { data: team, error: teamError } = await admin
    .from("teams")
    .insert({ name: defaultName, created_by: userId })
    .select("id")
    .single();

  if (teamError) {
    throw new Error(`Failed to create team: ${teamError.message}`);
  }

  const { error: memberError } = await admin
    .from("team_members")
    .insert({ team_id: team.id, user_id: userId, role: "owner" });

  if (memberError) {
    // Roll back the orphan team so a retry starts clean.
    await admin.from("teams").delete().eq("id", team.id);
    throw new Error(`Failed to create team owner: ${memberError.message}`);
  }

  return { teamId: team.id, role: "owner" };
}

/**
 * Where a signed-in user should be diverted because their team access ended:
 * "removed" (an event, from team_notices) or "lapsed" (derived — the owner's
 * plan expired). Null when the user has access or has no team issue.
 */
export type TeamGate =
  | { kind: "removed"; teamName: string; noticeId: string }
  | { kind: "lapsed"; teamName: string; ownerName: string | null };

/** Record a one-time "you were removed from {team}" notice for a user. */
export async function recordRemovalNotice(
  admin: PirolSupabaseClient,
  userId: string,
  teamName: string
): Promise<void> {
  const { error } = await admin
    .from("team_notices")
    .insert({ user_id: userId, type: "removed", team_name: teamName });

  if (error) {
    throw new Error(`Failed to record removal notice: ${error.message}`);
  }
}

/** The user's most recent unseen removal notice, if any. */
export async function getUnseenRemovalNotice(
  admin: PirolSupabaseClient,
  userId: string
): Promise<{ id: string; teamName: string } | null> {
  const { data, error } = await admin
    .from("team_notices")
    .select("id, team_name")
    .eq("user_id", userId)
    .eq("type", "removed")
    .is("seen_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load notices: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return { id: data.id, teamName: data.team_name };
}

/** Mark a notice seen so it isn't shown again. */
export async function markNoticeSeen(
  admin: PirolSupabaseClient,
  noticeId: string
): Promise<void> {
  const { error } = await admin
    .from("team_notices")
    .update({ seen_at: new Date().toISOString() })
    .eq("id", noticeId);

  if (error) {
    throw new Error(`Failed to mark notice seen: ${error.message}`);
  }
}

/**
 * Decide whether a signed-in user should be diverted to the team-inactive
 * interstitial. Returns null when they still have access (admin, own
 * subscription, or an active team owner). Removal (an event) takes
 * precedence over lapse (derived). Takes both a session client (for the
 * auth.uid()-scoped checks) and the admin client (for notices).
 */
export async function resolveTeamGate(
  sessionClient: PirolSupabaseClient,
  admin: PirolSupabaseClient,
  userId: string
): Promise<TeamGate | null> {
  const { data: access } = await sessionClient.rpc("has_archive_access");
  if (access) {
    return null;
  }

  const notice = await getUnseenRemovalNotice(admin, userId);
  if (notice) {
    return { kind: "removed", teamName: notice.teamName, noticeId: notice.id };
  }

  const ctx = await getTeamContext(sessionClient);
  if (ctx && ctx.role === "member" && !ctx.ownerActive) {
    return { kind: "lapsed", teamName: ctx.teamName, ownerName: ctx.ownerName };
  }

  return null;
}

/**
 * The caller's team id and the user ids of all its members. Used to
 * authorize copying team-shared items (the owner must be a co-member) via
 * the admin client, which works even for a lapsed member who has lost
 * archive access. Null when the caller is on no team.
 */
export async function getTeamMembership(
  admin: PirolSupabaseClient,
  userId: string
): Promise<{ teamId: string; memberIds: string[] } | null> {
  const { data: mine, error } = await admin
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load membership: ${error.message}`);
  }
  if (!mine) return null;

  const { data: members, error: membersError } = await admin
    .from("team_members")
    .select("user_id")
    .eq("team_id", mine.team_id);

  if (membersError) {
    throw new Error(`Failed to load team members: ${membersError.message}`);
  }

  return {
    teamId: mine.team_id,
    memberIds: (members ?? []).map((m) => m.user_id)
  };
}

/** Resolve an email to a user id via the service-role-only DB lookup. */
export async function findUserIdByEmail(
  admin: PirolSupabaseClient,
  email: string
): Promise<string | null> {
  const { data, error } = await admin.rpc("get_user_id_by_email", {
    p_email: email
  });

  if (error) {
    throw new Error(`Failed to look up user: ${error.message}`);
  }

  return data ?? null;
}

/**
 * Add a user to a team. Returns "already_in_team" when the one-team-per-
 * user index rejects the insert (they belong to this or another team).
 */
export async function addMember(
  admin: PirolSupabaseClient,
  teamId: string,
  userId: string
): Promise<"added" | "already_in_team"> {
  const { error } = await admin
    .from("team_members")
    .insert({ team_id: teamId, user_id: userId, role: "member" });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return "already_in_team";
    }
    throw new Error(`Failed to add member: ${error.message}`);
  }

  return "added";
}

export async function removeMember(
  admin: PirolSupabaseClient,
  teamId: string,
  userId: string
): Promise<void> {
  const { error } = await admin
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to remove member: ${error.message}`);
  }
}

/**
 * Record a pending invite for an email that has no account yet. Returns
 * "duplicate" when a pending invite for (team, email) already exists.
 */
export async function createPendingInvite(
  admin: PirolSupabaseClient,
  teamId: string,
  email: string,
  invitedBy: string
): Promise<PendingInviteView | "duplicate"> {
  const { data, error } = await admin
    .from("team_invites")
    .insert({ team_id: teamId, email, invited_by: invitedBy })
    .select("id, email, created_at, invited_by")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return "duplicate";
    }
    throw new Error(`Failed to create invite: ${error.message}`);
  }

  return {
    id: data.id,
    email: data.email,
    createdAt: data.created_at,
    invitedByUserId: data.invited_by,
    resendCount: 0,
    lastSentAt: data.created_at
  };
}

/**
 * Record a successful invite resend: bump the counter and stamp the send
 * time. The caller checks the cooldown/limit before sending; this only
 * runs after the email actually goes out.
 */
export async function markInviteResent(
  admin: PirolSupabaseClient,
  inviteId: string
): Promise<void> {
  const { error } = await admin.rpc("bump_invite_resend", {
    p_invite_id: inviteId
  });

  if (error) {
    throw new Error(`Failed to record invite resend: ${error.message}`);
  }
}

/** Hard-delete an invite row (used to roll back when the email fails to send). */
export async function deleteInvite(
  admin: PirolSupabaseClient,
  inviteId: string
): Promise<void> {
  const { error } = await admin.from("team_invites").delete().eq("id", inviteId);

  if (error) {
    throw new Error(`Failed to delete invite: ${error.message}`);
  }
}

export async function revokeInvite(
  admin: PirolSupabaseClient,
  teamId: string,
  inviteId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("team_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("team_id", teamId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    throw new Error(`Failed to revoke invite: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

/**
 * Claim pending invites for a freshly authenticated user, matched by
 * email. Joins the oldest invite's team; any other pending invites for
 * the email are revoked (one team per user). Idempotent — safe to run on
 * every auth callback. Returns true only when the user actually joined a
 * team on this call (so the caller can route them to the team welcome).
 */
export async function claimPendingInvites(
  admin: PirolSupabaseClient,
  userId: string,
  email: string
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();

  const { data: invites, error } = await admin
    .from("team_invites")
    .select("id, team_id")
    .eq("email", normalized)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load pending invites: ${error.message}`);
  }

  if (!invites || invites.length === 0) {
    return false;
  }

  const [oldest, ...rest] = invites;

  const outcome = await addMember(admin, oldest.team_id, userId);
  const staleIds =
    outcome === "added" ? rest.map((invite) => invite.id) : invites.map((invite) => invite.id);

  if (outcome === "added") {
    const { error: acceptError } = await admin
      .from("team_invites")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", oldest.id);

    if (acceptError) {
      throw new Error(`Failed to accept invite: ${acceptError.message}`);
    }
  }

  if (staleIds.length > 0) {
    const { error: revokeError } = await admin
      .from("team_invites")
      .update({ status: "revoked" })
      .in("id", staleIds);

    if (revokeError) {
      throw new Error(`Failed to revoke stale invites: ${revokeError.message}`);
    }
  }

  return outcome === "added";
}

/**
 * Resolve team ownership before an account hard-delete. Owner with other
 * members → promote the longest-tenured member; sole owner → delete the
 * team (cascades members + invites); plain member → no-op (the membership
 * row cascades with the auth user).
 */
export async function handleOwnerDeparture(
  admin: PirolSupabaseClient,
  userId: string
): Promise<void> {
  const { data: membership, error } = await admin
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load membership: ${error.message}`);
  }

  if (!membership || membership.role !== "owner") {
    return;
  }

  const { data: others, error: othersError } = await admin
    .from("team_members")
    .select("user_id")
    .eq("team_id", membership.team_id)
    .neq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (othersError) {
    throw new Error(`Failed to load team members: ${othersError.message}`);
  }

  if (!others || others.length === 0) {
    const { error: deleteError } = await admin
      .from("teams")
      .delete()
      .eq("id", membership.team_id);

    if (deleteError) {
      throw new Error(`Failed to delete team: ${deleteError.message}`);
    }
    return;
  }

  const { error: promoteError } = await admin
    .from("team_members")
    .update({ role: "owner" })
    .eq("team_id", membership.team_id)
    .eq("user_id", others[0].user_id);

  if (promoteError) {
    throw new Error(`Failed to promote new owner: ${promoteError.message}`);
  }
}
