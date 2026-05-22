-- Pirol — Competitor sets (user-owned, private groupings of brands).
--
-- A user (today: any admin) curates a named group of `companies` ("Eyewear
-- rivals", "Nordic furniture", ...). The Compare tab uses these sets to
-- render side-by-side analytics for the contained brands. Unlike
-- `collections`, competitor sets are *private*: the brand selection is
-- considered sensitive (it reveals who the user benchmarks against), so
-- there's no public share slug and no `anon` read policy.
--
-- Model:
--   • `competitor_sets`     — one row per named set, owned by `user_id`.
--   • `competitor_set_members` — many-to-many between sets and companies,
--                                composite PK so the same company can't be
--                                added twice to the same set.

create extension if not exists pgcrypto;

create table if not exists public.competitor_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0 and length(name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists competitor_sets_user_updated_idx
  on public.competitor_sets (user_id, updated_at desc);

-- Keep `updated_at` in sync on every mutation so the sidebar's
-- "most recently used" ordering stays cheap to compute.
create or replace function public.competitor_sets_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists competitor_sets_set_updated_at on public.competitor_sets;
create trigger competitor_sets_set_updated_at
  before update on public.competitor_sets
  for each row execute function public.competitor_sets_set_updated_at();

create table if not exists public.competitor_set_members (
  set_id uuid not null references public.competitor_sets(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (set_id, company_id)
);

create index if not exists competitor_set_members_set_added_idx
  on public.competitor_set_members (set_id, added_at desc);

create index if not exists competitor_set_members_company_idx
  on public.competitor_set_members (company_id);

-- Bump the parent set's `updated_at` whenever its membership changes, so
-- the sidebar's most-recently-used ordering also reflects "I just added
-- a brand", not only "I renamed it".
create or replace function public.competitor_set_members_touch_parent()
returns trigger
language plpgsql
as $$
declare
  affected_id uuid;
begin
  if tg_op = 'DELETE' then
    affected_id := old.set_id;
  else
    affected_id := new.set_id;
  end if;
  update public.competitor_sets
     set updated_at = now()
   where id = affected_id;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists competitor_set_members_touch_parent
  on public.competitor_set_members;
create trigger competitor_set_members_touch_parent
  after insert or delete on public.competitor_set_members
  for each row execute function public.competitor_set_members_touch_parent();

-- ---------- RLS: competitor_sets ----------

alter table public.competitor_sets enable row level security;

drop policy if exists competitor_sets_service_role_all on public.competitor_sets;
create policy competitor_sets_service_role_all
  on public.competitor_sets
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists competitor_sets_admin_select on public.competitor_sets;
create policy competitor_sets_admin_select
  on public.competitor_sets
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

drop policy if exists competitor_sets_admin_insert on public.competitor_sets;
create policy competitor_sets_admin_insert
  on public.competitor_sets
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

drop policy if exists competitor_sets_admin_update on public.competitor_sets;
create policy competitor_sets_admin_update
  on public.competitor_sets
  for update
  to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  )
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

drop policy if exists competitor_sets_admin_delete on public.competitor_sets;
create policy competitor_sets_admin_delete
  on public.competitor_sets
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

grant select, insert, update, delete on public.competitor_sets to authenticated;

-- ---------- RLS: competitor_set_members ----------

alter table public.competitor_set_members enable row level security;

drop policy if exists competitor_set_members_service_role_all
  on public.competitor_set_members;
create policy competitor_set_members_service_role_all
  on public.competitor_set_members
  for all
  to service_role
  using (true)
  with check (true);

-- Membership rows are visible to whoever owns the parent set (and is an
-- admin). Mirrors the gating on `competitor_sets`.
drop policy if exists competitor_set_members_admin_select
  on public.competitor_set_members;
create policy competitor_set_members_admin_select
  on public.competitor_set_members
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.competitor_sets s
      where s.id = set_id
        and s.user_id = auth.uid()
    )
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

drop policy if exists competitor_set_members_admin_insert
  on public.competitor_set_members;
create policy competitor_set_members_admin_insert
  on public.competitor_set_members
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.competitor_sets s
      where s.id = set_id
        and s.user_id = auth.uid()
    )
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

drop policy if exists competitor_set_members_admin_delete
  on public.competitor_set_members;
create policy competitor_set_members_admin_delete
  on public.competitor_set_members
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.competitor_sets s
      where s.id = set_id
        and s.user_id = auth.uid()
    )
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

grant select, insert, delete on public.competitor_set_members to authenticated;
