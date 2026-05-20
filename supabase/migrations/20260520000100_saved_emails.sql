-- Pirol — Saved emails (user-scoped "bookmarks") for the Explore grid.
--
-- The Explore tab lets an admin user star an email so they can find it again
-- under a dedicated /saved gallery. Saves are user-scoped (each admin keeps
-- their own list), addressed by `(user_id, email_id)`. RLS is structured so
-- that an authenticated row can only ever be inserted / read / deleted by the
-- owning user, *and* only when that user is also in `admin_users` — matching
-- the broader Pirol gating model.

create table if not exists public.saved_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_id uuid not null references public.captured_emails(id) on delete cascade,
  saved_at timestamptz not null default now()
);

create unique index if not exists saved_emails_user_email_unique
  on public.saved_emails (user_id, email_id);

create index if not exists saved_emails_user_saved_at_idx
  on public.saved_emails (user_id, saved_at desc);

alter table public.saved_emails enable row level security;

drop policy if exists saved_emails_service_role_all on public.saved_emails;
create policy saved_emails_service_role_all
  on public.saved_emails
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists saved_emails_admin_select on public.saved_emails;
create policy saved_emails_admin_select
  on public.saved_emails
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

drop policy if exists saved_emails_admin_insert on public.saved_emails;
create policy saved_emails_admin_insert
  on public.saved_emails
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

drop policy if exists saved_emails_admin_delete on public.saved_emails;
create policy saved_emails_admin_delete
  on public.saved_emails
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.admin_users au where au.user_id = auth.uid())
  );

grant select, insert, delete on public.saved_emails to authenticated;
