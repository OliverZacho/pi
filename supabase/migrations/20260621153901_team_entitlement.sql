-- ============================================================
-- Team-plan entitlement: members inherit the owner's team subscription.
--
-- Teams were grouping-only until now (see 20260610090500_teams.sql) —
-- `has_archive_access()` ignored membership, so an invited member got no
-- access. This grants access to any member of a team whose OWNER holds an
-- active "team" subscription, reusing the same active/trialing/grace logic
-- as the self-subscription branch.
--
-- A member's active/inactive state is therefore DERIVED, never stored: when
-- the owner's plan lapses, members silently lose access and nothing is
-- deleted (all user data is keyed by user_id). Re-activation is automatic if
-- the owner re-subscribes.
-- ============================================================

create or replace function public.has_archive_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.admin_users a where a.user_id = auth.uid())
    -- Own subscription (solo or team owner): active/trialing within period,
    -- or past_due within the dunning grace window.
    or exists (
      select 1 from public.subscriptions s
      where s.user_id = auth.uid()
        and (
          (
            s.status in ('active','trialing')
            and (s.current_period_end is null or s.current_period_end > now())
          )
          or (
            s.status = 'past_due'
            and s.grace_until is not null
            and s.grace_until > now()
          )
        )
    )
    -- Team membership: access flows from the team owner's active "team" plan.
    or exists (
      select 1
      from public.team_members me
      join public.team_members owner
        on owner.team_id = me.team_id and owner.role = 'owner'
      join public.subscriptions s on s.user_id = owner.user_id
      where me.user_id = auth.uid()
        and s.plan = 'team'
        and (
          (
            s.status in ('active','trialing')
            and (s.current_period_end is null or s.current_period_end > now())
          )
          or (
            s.status = 'past_due'
            and s.grace_until is not null
            and s.grace_until > now()
          )
        )
    );
$$;

-- ------------------------------------------------------------
-- Team context for the caller — single source of truth for the Settings
-- UI (member vs owner, "managed by …") and the lapse interstitial.
--
-- SECURITY DEFINER so it can read the service-role-only team tables, but it
-- only ever returns the caller's own membership (where me.user_id =
-- auth.uid()), so it is safe to grant to authenticated. Returns zero rows
-- when the caller belongs to no team.
-- ------------------------------------------------------------
create or replace function public.get_team_context()
returns table (
  team_id uuid,
  team_name text,
  role text,
  owner_user_id uuid,
  owner_name text,
  owner_active boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id as team_id,
    t.name as team_name,
    me.role as role,
    owner.user_id as owner_user_id,
    op.full_name as owner_name,
    exists (
      select 1 from public.subscriptions s
      where s.user_id = owner.user_id
        and s.plan = 'team'
        and (
          (
            s.status in ('active','trialing')
            and (s.current_period_end is null or s.current_period_end > now())
          )
          or (
            s.status = 'past_due'
            and s.grace_until is not null
            and s.grace_until > now()
          )
        )
    ) as owner_active
  from public.team_members me
  join public.teams t on t.id = me.team_id
  join public.team_members owner
    on owner.team_id = me.team_id and owner.role = 'owner'
  left join public.user_profiles op on op.user_id = owner.user_id
  where me.user_id = auth.uid();
$$;

revoke all on function public.get_team_context() from public;
revoke all on function public.get_team_context() from anon;
grant execute on function public.get_team_context() to authenticated;
grant execute on function public.get_team_context() to service_role;
