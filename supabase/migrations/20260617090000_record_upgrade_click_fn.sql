-- ============================================================
-- Least-privilege write path for upgrade-CTA click tracking.
--
-- The /api/track/upgrade-click route is unauthenticated and internet-facing,
-- so we don't want it holding the service-role key. Instead this SECURITY
-- DEFINER function is the *only* way to write a row: RLS on upgrade_clicks
-- stays fully locked, the function can only insert into that one table, and
-- it stamps the caller's own auth.uid() (null for logged-out visitors).
--
-- Mirrors the touch_user_visit pattern already used in this schema, but is
-- granted to anon/authenticated so the public CTA can record clicks through
-- the ordinary cookie-scoped client — no service role in the request path.
-- ============================================================

create or replace function public.record_upgrade_click(
  p_source text,
  p_path text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Validate the tag in the database too (defence in depth): lowercase
  -- letters/digits/underscore/hyphen, 1–48 chars. Anything else is rejected
  -- before it can reach the table.
  if p_source is null or p_source !~ '^[a-z0-9_-]{1,48}$' then
    raise exception 'invalid upgrade-click source' using errcode = '22023';
  end if;

  insert into public.upgrade_clicks (source, path, user_id)
  values (p_source, left(p_path, 512), auth.uid());
end;
$$;

revoke all on function public.record_upgrade_click(text, text) from public;
grant execute on function public.record_upgrade_click(text, text)
  to anon, authenticated, service_role;
