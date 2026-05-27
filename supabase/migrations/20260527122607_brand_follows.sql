-- Pirol — Brand follows (per-user "I care about this brand" signal).
--
-- A follow is a global preference attached to a single user/brand pair.
-- It powers the home feed, notifications, and digest emails. It is
-- intentionally orthogonal to `competitor_sets` (which are *grouping*
-- primitives used by the Compare tab): a brand can be followed without
-- belonging to any group, and a brand can sit in many groups without
-- the user following it. Two tables, two lifecycles, no cascade between
-- them.
--
-- The model is the same minimal shape as `saved_emails` — there's no
-- parent row, the user is the implicit owner, and the composite primary
-- key gives idempotent follow/unfollow semantics.

create extension if not exists pgcrypto;

create table if not exists public.brand_follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

create index if not exists brand_follows_user_created_idx
  on public.brand_follows (user_id, created_at desc);

create index if not exists brand_follows_company_idx
  on public.brand_follows (company_id);

-- ---------- RLS ----------

alter table public.brand_follows enable row level security;

drop policy if exists brand_follows_service_role_all on public.brand_follows;
create policy brand_follows_service_role_all
  on public.brand_follows
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists brand_follows_admin_select on public.brand_follows;
create policy brand_follows_admin_select
  on public.brand_follows
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

drop policy if exists brand_follows_admin_insert on public.brand_follows;
create policy brand_follows_admin_insert
  on public.brand_follows
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

drop policy if exists brand_follows_admin_delete on public.brand_follows;
create policy brand_follows_admin_delete
  on public.brand_follows
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

grant select, insert, delete on public.brand_follows to authenticated;
