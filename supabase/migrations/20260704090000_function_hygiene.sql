-- Pirol — database hygiene pass (2026-07-04 launch audit).
--
-- 1. Pin `search_path` on the trigger/helper functions the Supabase linter
--    flags as role-mutable (0011_function_search_path_mutable). All of them
--    only touch `public`, so pinning is behavior-preserving.
-- 2. Revoke EXECUTE the API roles never need:
--    - `support_chat_touch_thread` is a trigger function; it runs as the
--      table owner and is never called via /rest/v1/rpc.
--    - `email_asset_sizes` is only ever called server-side with an
--      authenticated session or the service role; `anon` has no caller.
--    The intentionally-public RPCs (`bump_rate_limit`, `record_*`) keep
--    their grants — see the service-role write pattern.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'collections_set_updated_at',
        'competitor_sets_set_updated_at',
        'competitor_set_members_touch_parent',
        'captured_emails_sync_group_segments',
        'captured_emails_set_dedup',
        'captured_email_group_segments',
        'captured_email_content_hash',
        'slugify',
        'companies_set_slug'
      )
  loop
    execute format('alter function %s set search_path = public', fn.sig);
  end loop;
end $$;

revoke execute on function public.support_chat_touch_thread() from anon, authenticated;
revoke execute on function public.email_asset_sizes(text[]) from anon;
