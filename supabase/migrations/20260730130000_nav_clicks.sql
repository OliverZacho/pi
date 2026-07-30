-- ============================================================
-- Sidebar nav click tracking.
--
-- Every primary left-panel nav button (Explore, Saved, Brands, Following,
-- Collections, Comparisons, Your brand) records a row here when clicked,
-- tagged with the stable `nav_id` of the button and the page it was clicked
-- from. Lets us see which app surfaces users actually explore, per user and
-- in aggregate.
--
-- Mirrors the upgrade_clicks design exactly: the table is fully locked under
-- RLS (service role only), and the sole write path for the public route is
-- the record_nav_click SECURITY DEFINER function below, which stamps the
-- caller's own auth.uid(). See 20260616120000_upgrade_clicks.sql.
-- ============================================================

create table if not exists public.nav_clicks (
  id uuid primary key default gen_random_uuid(),
  -- Stable identifier for the nav button that was clicked (e.g. "explore").
  nav_id text not null,
  -- The page path the click happened on (for context; may be null).
  path text,
  -- Signed-in clicker, when known. Null for logged-out visitors.
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists nav_clicks_nav_id_idx
  on public.nav_clicks (nav_id);
create index if not exists nav_clicks_created_at_idx
  on public.nav_clicks (created_at desc);
create index if not exists nav_clicks_user_id_idx
  on public.nav_clicks (user_id);

alter table public.nav_clicks enable row level security;

-- No policies for anon/authenticated: all direct access is via the service role.
grant select, insert on public.nav_clicks to service_role;

-- ------------------------------------------------------------
-- Least-privilege write path.
--
-- The /api/track/nav-click route is fire-and-forget (navigator.sendBeacon)
-- and uses the ordinary cookie-scoped client, so it holds no elevated
-- credential. This function is the only way to write a row: RLS stays fully
-- locked, the function can only insert into nav_clicks, and it stamps the
-- caller's own auth.uid() (null for logged-out visitors).
-- ------------------------------------------------------------

create or replace function public.record_nav_click(
  p_nav_id text,
  p_path text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Validate the tag in the database too (defence in depth): lowercase
  -- letters/digits/underscore/hyphen, 1-48 chars. Anything else is rejected
  -- before it can reach the table.
  if p_nav_id is null or p_nav_id !~ '^[a-z0-9_-]{1,48}$' then
    raise exception 'invalid nav-click id' using errcode = '22023';
  end if;

  insert into public.nav_clicks (nav_id, path, user_id)
  values (p_nav_id, left(p_path, 512), auth.uid());
end;
$$;

revoke all on function public.record_nav_click(text, text) from public;
grant execute on function public.record_nav_click(text, text)
  to anon, authenticated, service_role;
