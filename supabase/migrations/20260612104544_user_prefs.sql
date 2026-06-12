-- Pirol — per-user UI preference store.
--
-- Generic (user_id, key) → jsonb so future preference surfaces don't
-- need a migration each. First consumer: the Comparisons dashboard's
-- section layout (hidden sections + custom order) under the key
-- 'compare_sections'. Values are validated/sanitized in the app layer
-- (lib/comparison-sections.ts) — the table stays schema-agnostic.
--
-- RLS is plain own-row access (no admin_users gate, unlike the older
-- brand_follows policies): preferences are harmless personal UI state
-- and paying subscribers need them too. API routes still gate writes
-- behind archive access.

create table if not exists public.user_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (char_length(key) between 1 and 80),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_prefs enable row level security;

drop policy if exists user_prefs_service_role_all on public.user_prefs;
create policy user_prefs_service_role_all
  on public.user_prefs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists user_prefs_own_select on public.user_prefs;
create policy user_prefs_own_select
  on public.user_prefs
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists user_prefs_own_insert on public.user_prefs;
create policy user_prefs_own_insert
  on public.user_prefs
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_prefs_own_update on public.user_prefs;
create policy user_prefs_own_update
  on public.user_prefs
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_prefs_own_delete on public.user_prefs;
create policy user_prefs_own_delete
  on public.user_prefs
  for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.user_prefs to authenticated;
