-- ============================================================
-- Track "does this user have a password" ourselves.
--
-- GoTrue stores a bcrypt hash of a RANDOM password for OTP/magic-link
-- signups, so `encrypted_password is not null` is true for everyone and
-- user_has_password() wrongly demanded a current password from brand-new
-- signups ("Current password is required" on the /signup password step).
--
-- Instead, user_profiles.password_set_at records when a real password was
-- established:
--   * INSERT with raw_user_meta_data.password_signup = true (checkout
--     signUp-with-password sends this flag; OTP inserts carry a random
--     hash and no flag).
--   * UPDATE where encrypted_password actually changes (set/change via
--     /api/account/password, future recovery flows, hash upgrades on
--     password login — all imply a real password).
-- Existing users start at null; anyone who did have a password re-stamps
-- on their next password change.
-- ============================================================

alter table public.user_profiles
  add column if not exists password_set_at timestamptz;

create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (user_id, email, password_set_at)
  values (
    new.id,
    coalesce(new.email, ''),
    case
      when TG_OP = 'INSERT' and (new.raw_user_meta_data ->> 'password_signup') = 'true'
        then now()
    end
  )
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = now();

  if TG_OP = 'UPDATE'
     and new.encrypted_password is distinct from old.encrypted_password
     and new.encrypted_password is not null
     and new.encrypted_password <> '' then
    update public.user_profiles
      set password_set_at = now(),
          updated_at = now()
      where user_id = new.id;
  end if;

  return new;
end;
$$;

-- Re-point the trigger so genuine password changes fire it too. GoTrue's
-- full-row updates list the column without changing it; the OLD/NEW
-- comparison above filters those out.
drop trigger if exists on_auth_user_change on auth.users;
create trigger on_auth_user_change
  after insert or update of email, encrypted_password on auth.users
  for each row execute function public.handle_auth_user_change();

create or replace function public.user_has_password()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.password_set_at is not null
     from public.user_profiles p where p.user_id = auth.uid()),
    false
  );
$$;
