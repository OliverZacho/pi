-- Pirol — Collections (user-owned, publicly shareable email groupings).
--
-- A user (today: any admin) can group `captured_emails` rows into a named
-- "collection" — think Pinterest boards. The owner is the only one who can
-- mutate the collection or its membership, but *every* collection is
-- publicly readable by `share_slug` so anyone with the link can view it
-- without an account.
--
-- The model is intentionally close to `saved_emails` (separate user-scoped
-- bookmark feature), with two new wrinkles:
--   • `share_slug` is the URL-safe public handle (`/c/<slug>`). Generated
--     server-side and unique across the table.
--   • RLS allows the `anon` role to `select` rows so the public share page
--     can resolve a collection (and its members) without authentication.

create extension if not exists pgcrypto;

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0 and length(name) <= 120),
  share_slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists collections_user_updated_idx
  on public.collections (user_id, updated_at desc);

create index if not exists collections_share_slug_idx
  on public.collections (share_slug);

-- Keep `updated_at` in sync on every mutation so the sidebar's
-- "most recently used" ordering stays cheap to compute.
create or replace function public.collections_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists collections_set_updated_at on public.collections;
create trigger collections_set_updated_at
  before update on public.collections
  for each row execute function public.collections_set_updated_at();

create table if not exists public.collection_emails (
  collection_id uuid not null references public.collections(id) on delete cascade,
  email_id uuid not null references public.captured_emails(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, email_id)
);

create index if not exists collection_emails_collection_added_idx
  on public.collection_emails (collection_id, added_at desc);

create index if not exists collection_emails_email_idx
  on public.collection_emails (email_id);

-- ---------- RLS: collections ----------

alter table public.collections enable row level security;

drop policy if exists collections_service_role_all on public.collections;
create policy collections_service_role_all
  on public.collections
  for all
  to service_role
  using (true)
  with check (true);

-- Public read: anyone (including the `anon` role) can resolve a
-- collection. The whole point is link sharing; the slug is the secret.
drop policy if exists collections_public_select on public.collections;
create policy collections_public_select
  on public.collections
  for select
  to anon, authenticated
  using (true);

drop policy if exists collections_admin_insert on public.collections;
create policy collections_admin_insert
  on public.collections
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

drop policy if exists collections_admin_update on public.collections;
create policy collections_admin_update
  on public.collections
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

drop policy if exists collections_admin_delete on public.collections;
create policy collections_admin_delete
  on public.collections
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

grant select on public.collections to anon;
grant select, insert, update, delete on public.collections to authenticated;

-- ---------- RLS: collection_emails ----------

alter table public.collection_emails enable row level security;

drop policy if exists collection_emails_service_role_all on public.collection_emails;
create policy collection_emails_service_role_all
  on public.collection_emails
  for all
  to service_role
  using (true)
  with check (true);

-- Public read: mirrors `collections_public_select`. Because the parent
-- collection is always selectable, the membership rows must be too —
-- otherwise a shared collection would render as empty for anonymous
-- visitors.
drop policy if exists collection_emails_public_select on public.collection_emails;
create policy collection_emails_public_select
  on public.collection_emails
  for select
  to anon, authenticated
  using (true);

drop policy if exists collection_emails_admin_insert on public.collection_emails;
create policy collection_emails_admin_insert
  on public.collection_emails
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.collections c
      where c.id = collection_id
        and c.user_id = auth.uid()
    )
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

drop policy if exists collection_emails_admin_delete on public.collection_emails;
create policy collection_emails_admin_delete
  on public.collection_emails
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.collections c
      where c.id = collection_id
        and c.user_id = auth.uid()
    )
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

grant select on public.collection_emails to anon;
grant select, insert, delete on public.collection_emails to authenticated;
