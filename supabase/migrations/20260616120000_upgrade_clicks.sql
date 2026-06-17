-- ============================================================
-- Upgrade-CTA click tracking.
--
-- Every "Upgrade" / "Subscribe" / "View plans" button in the app records a
-- row here when clicked, tagged with a stable `source` identifying *which*
-- button it was (e.g. "brand_hero", "brand_paywall", "explore_paywall").
-- The admin "Upgrades" dashboard reads these aggregates to see which CTAs
-- drive the most intent.
--
-- Writes happen through the service-role client (the API route), so logged-out
-- visitors are captured too; `user_id` is filled in only when the clicker is
-- signed in. RLS is enabled with no anon/authenticated policies, so the table
-- is reachable solely via the service role (which bypasses RLS).
-- ============================================================

create table if not exists public.upgrade_clicks (
  id uuid primary key default gen_random_uuid(),
  -- Stable identifier for the button that was clicked.
  source text not null,
  -- The page path the click happened on (for context; may be null).
  path text,
  -- Signed-in clicker, when known. Null for logged-out visitors.
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists upgrade_clicks_source_idx
  on public.upgrade_clicks (source);
create index if not exists upgrade_clicks_created_at_idx
  on public.upgrade_clicks (created_at desc);

alter table public.upgrade_clicks enable row level security;

-- No policies for anon/authenticated: all access is via the service role.
grant select, insert on public.upgrade_clicks to service_role;
