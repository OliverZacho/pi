-- ============================================================
-- One-time notices for team membership events.
--
-- Membership "active/inactive" is derived (see 20260621000000), but an
-- explicit removal is an event with no surviving state: removing a member
-- deletes their team_members row, so there's nothing left to message
-- against on next login. This table records that event so the app can show
-- the removed user a one-time notice ("you've been removed — subscribe or
-- browse free") and then mark it seen.
--
-- A lapse (owner's plan expires) needs no row here — it's derived live from
-- the owner's subscription via get_team_context().
--
-- RLS is service_role-only, consistent with the other team tables: the
-- /team/inactive page and the removal route read/write via the admin
-- client after resolving the caller's identity server-side.
-- ============================================================

create table if not exists public.team_notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('removed')),
  team_name text not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);

-- Fast lookup of a user's outstanding (unseen) notices.
create index if not exists team_notices_unseen_idx
  on public.team_notices (user_id) where seen_at is null;

alter table public.team_notices enable row level security;

drop policy if exists team_notices_service_all on public.team_notices;
create policy team_notices_service_all on public.team_notices
  for all to service_role using (true) with check (true);
