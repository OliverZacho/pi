-- OAuth signups (Google) arrive with the user's name in
-- auth.users.raw_user_meta_data, but the user_profiles sync trigger only
-- copied user_id + email, so the Settings "Full name" field started empty
-- for them. Seed full_name from the metadata on insert, and on later
-- syncs only fill it when the profile has none — a name the user typed
-- in Settings always wins.

create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_name text := nullif(trim(coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    ''
  )), '');
begin
  insert into public.user_profiles (user_id, email, full_name)
  values (new.id, coalesce(new.email, ''), meta_name)
  on conflict (user_id) do update
    set email = excluded.email,
        full_name = coalesce(user_profiles.full_name, excluded.full_name),
        updated_at = now();
  return new;
end;
$$;

-- Backfill: existing users without a profile name inherit their provider
-- metadata name where one exists.
update public.user_profiles p
set full_name = sub.meta_name,
    updated_at = now()
from (
  select
    id,
    nullif(trim(coalesce(
      raw_user_meta_data->>'full_name',
      raw_user_meta_data->>'name',
      ''
    )), '') as meta_name
  from auth.users
) sub
where sub.id = p.user_id
  and p.full_name is null
  and sub.meta_name is not null;
