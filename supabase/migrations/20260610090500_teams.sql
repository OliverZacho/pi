-- ============================================================
-- Teams for the Settings Team tab. Grouping only — membership has NO
-- entitlement effect (has_archive_access() is untouched).
--
-- Model: one team per user (unique index on team_members.user_id). The
-- first invite a user sends creates their team with them as owner. Invites
-- are restricted to the inviter's email domain. Existing users are added
-- directly; unknown emails get a Supabase auth invite (magic link) and a
-- pending row here that is claimed by email match on first sign-in.
--
-- RLS is service_role-only: all reads/writes go through server routes that
-- enforce ownership explicitly, which avoids recursive team_members
-- policies and keeps the client surface zero.
-- ============================================================

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- One team per user.
create unique index if not exists team_members_user_unique
  on public.team_members (user_id);

create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  invited_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

-- At most one live invite per (team, email).
create unique index if not exists team_invites_pending_unique
  on public.team_invites (team_id, email) where status = 'pending';

-- Claim-on-login looks up pending invites by email.
create index if not exists team_invites_email_pending_idx
  on public.team_invites (email) where status = 'pending';

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;

drop policy if exists teams_service_all on public.teams;
create policy teams_service_all on public.teams
  for all to service_role using (true) with check (true);

drop policy if exists team_members_service_all on public.team_members;
create policy team_members_service_all on public.team_members
  for all to service_role using (true) with check (true);

drop policy if exists team_invites_service_all on public.team_invites;
create policy team_invites_service_all on public.team_invites
  for all to service_role using (true) with check (true);

-- Invite flow needs "does this email belong to a user?". PostgREST cannot
-- query the auth schema and auth.admin.listUsers has no email filter, so
-- expose a narrow SECURITY DEFINER lookup to service_role only.
create or replace function public.get_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke all on function public.get_user_id_by_email(text) from public;
revoke all on function public.get_user_id_by_email(text) from anon;
revoke all on function public.get_user_id_by_email(text) from authenticated;
grant execute on function public.get_user_id_by_email(text) to service_role;
