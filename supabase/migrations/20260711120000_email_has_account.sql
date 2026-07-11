-- Signup flows verify new accounts with an emailed code, but Supabase silently
-- sends existing accounts a magic *link* instead (template choice follows user
-- existence). This pre-check lets the signup UI catch known emails up front and
-- point them to login rather than leaving them waiting for a code that never
-- comes. SECURITY DEFINER to read auth.users; callable pre-auth by design —
-- signup pages inherently reveal whether an email has an account.
create or replace function public.email_has_account(check_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users u
    where lower(u.email) = lower(trim(check_email))
      and u.deleted_at is null
  );
$$;
revoke all on function public.email_has_account(text) from public;
grant execute on function public.email_has_account(text) to anon;
grant execute on function public.email_has_account(text) to authenticated;
