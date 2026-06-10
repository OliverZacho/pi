import type { PirolSupabaseClient } from "./supabase-admin";

/**
 * Helpers for the Settings Team tab.
 *
 * Teams are grouping only — membership has no entitlement effect
 * (`has_archive_access()` is untouched). The model is one team per user
 * (unique index on `team_members.user_id`); the first invite a user sends
 * creates their team with them as owner.
 *
 * Every function takes the service-role admin client: the team tables are
 * RLS'd to service_role only, and the API routes enforce ownership
 * explicitly. That avoids recursive `team_members` policies and keeps the
 * client-side surface zero.
 */

const UNIQUE_VIOLATION = "23505";

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
};

export type TeamView = {
  id: string;
  name: string;
  viewerRole: "owner" | "member";
  members: TeamMemberView[];
  pendingInvites: PendingInviteView[];
};

function asRole(role: string): "owner" | "member" {
  return role === "owner" ? "owner" : "member";
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
        .select("id, email, created_at, invited_by")
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
    invitedByUserId: row.invited_by
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
    invitedByUserId: data.invited_by
  };
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
 * every auth callback.
 */
export async function claimPendingInvites(
  admin: PirolSupabaseClient,
  userId: string,
  email: string
): Promise<void> {
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
    return;
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
