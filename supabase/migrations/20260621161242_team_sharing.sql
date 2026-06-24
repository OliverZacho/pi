-- ============================================================
-- Share collections & comparisons within a team.
--
-- An owner can flag a collection or competitor_set as shared_with_team;
-- co-members of the owner's team then get READ access. Writes stay
-- owner-only (the existing member_insert/update/delete policies are
-- untouched). Visibility is derived from current team co-membership, so it
-- revokes automatically if the owner or reader leaves the team — no flag
-- cleanup needed.
--
-- team_members is RLS'd to service_role only, so an authenticated SELECT
-- policy can't subquery it directly (it would see zero rows). same_team_as()
-- bridges that as a SECURITY DEFINER helper, mirroring has_archive_access().
-- ============================================================

alter table public.collections
  add column if not exists shared_with_team boolean not null default false;

alter table public.competitor_sets
  add column if not exists shared_with_team boolean not null default false;

-- Whether the caller and another user are members of the same team.
-- SECURITY DEFINER so it can read the service-role-only team_members table;
-- only ever reveals a boolean about the caller's own co-membership.
create or replace function public.same_team_as(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members me
    join public.team_members other on other.team_id = me.team_id
    where me.user_id = auth.uid()
      and other.user_id = p_other
  );
$$;

revoke all on function public.same_team_as(uuid) from public;
revoke all on function public.same_team_as(uuid) from anon;
grant execute on function public.same_team_as(uuid) to authenticated;
grant execute on function public.same_team_as(uuid) to service_role;

-- ------------------------------------------------------------
-- Additive team-read SELECT policies. RLS OR-combines policies per command,
-- so these widen visibility without affecting the owner-only policies.
-- ------------------------------------------------------------

drop policy if exists collections_team_select on public.collections;
create policy collections_team_select on public.collections
  for select to authenticated
  using (
    shared_with_team is true
    and public.same_team_as(user_id)
    and public.has_archive_access()
  );

drop policy if exists collection_emails_team_select on public.collection_emails;
create policy collection_emails_team_select on public.collection_emails
  for select to authenticated
  using (
    public.has_archive_access()
    and exists (
      select 1 from public.collections c
      where c.id = collection_emails.collection_id
        and c.shared_with_team is true
        and public.same_team_as(c.user_id)
    )
  );

drop policy if exists competitor_sets_team_select on public.competitor_sets;
create policy competitor_sets_team_select on public.competitor_sets
  for select to authenticated
  using (
    shared_with_team is true
    and public.same_team_as(user_id)
    and public.has_archive_access()
  );

drop policy if exists competitor_set_members_team_select on public.competitor_set_members;
create policy competitor_set_members_team_select on public.competitor_set_members
  for select to authenticated
  using (
    public.has_archive_access()
    and exists (
      select 1 from public.competitor_sets s
      where s.id = competitor_set_members.set_id
        and s.shared_with_team is true
        and public.same_team_as(s.user_id)
    )
  );
