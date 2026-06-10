-- ============================================================
-- User profiles for the Settings page (full name + denormalized email).
--
-- A trigger on auth.users keeps the row in sync so server code can join
-- team members to a name/email without touching the auth schema, and the
-- Settings User tab can read/update the profile through RLS.
-- ============================================================

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

drop policy if exists user_profiles_self_select on public.user_profiles;
create policy user_profiles_self_select on public.user_profiles
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_profiles_self_update on public.user_profiles;
create policy user_profiles_self_update on public.user_profiles
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_profiles_service_all on public.user_profiles;
create policy user_profiles_service_all on public.user_profiles
  for all to service_role using (true) with check (true);

grant select, update on public.user_profiles to authenticated;

-- Keep (user_id, email) in sync with auth.users. SECURITY DEFINER so the
-- trigger can write past RLS; locked search_path.
create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (user_id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;
revoke all on function public.handle_auth_user_change() from public;
revoke all on function public.handle_auth_user_change() from anon;
revoke all on function public.handle_auth_user_change() from authenticated;

drop trigger if exists on_auth_user_change on auth.users;
create trigger on_auth_user_change
  after insert or update of email on auth.users
  for each row execute function public.handle_auth_user_change();

-- Backfill existing users.
insert into public.user_profiles (user_id, email)
select id, coalesce(email, '') from auth.users
on conflict (user_id) do update set email = excluded.email;

-- Magic-link signups have no password; the Settings password section shows
-- "Set a password" instead of "Change password" based on this. SECURITY
-- DEFINER to read auth.users; only reveals the caller's own flag.
create or replace function public.user_has_password()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select u.encrypted_password is not null and u.encrypted_password <> ''
     from auth.users u where u.id = auth.uid()),
    false
  );
$$;
revoke all on function public.user_has_password() from public;
revoke all on function public.user_has_password() from anon;
grant execute on function public.user_has_password() to authenticated;
