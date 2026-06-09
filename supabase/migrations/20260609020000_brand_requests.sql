-- Brand requests submitted by visitors when a search turns up no matching
-- brand. Captured from the public Explore brand filter and the Brands page
-- empty state, then triaged by an operator from the admin Create tab.

create table if not exists public.brand_requests (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  website text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

-- The admin block lists pending requests newest-first.
create index if not exists brand_requests_status_created_idx
  on public.brand_requests (status, created_at desc);

alter table public.brand_requests enable row level security;

-- Inserts arrive through a server route using the service-role key (visitors
-- may be logged out), so service_role needs full access.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'brand_requests' and policyname = 'service_role_full_access_brand_requests'
  ) then
    create policy service_role_full_access_brand_requests
    on public.brand_requests
    for all
    to service_role
    using (true)
    with check (true);
  end if;
end $$;

-- Admins read and triage requests from the dashboard.
drop policy if exists brand_requests_admin_all on public.brand_requests;
create policy brand_requests_admin_all
on public.brand_requests
for all
to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

grant select, insert, update, delete on public.brand_requests to authenticated;
