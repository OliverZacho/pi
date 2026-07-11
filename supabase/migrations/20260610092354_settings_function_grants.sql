-- Tighten execute grants on the settings SECURITY DEFINER functions:
-- the trigger function should not be callable via PostgREST at all, and
-- user_has_password is for signed-in users only.
revoke all on function public.handle_auth_user_change() from anon;
revoke all on function public.handle_auth_user_change() from authenticated;
revoke all on function public.user_has_password() from anon;
