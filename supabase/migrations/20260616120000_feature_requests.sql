-- Feature requests submitted by signed-in users from the account menu's
-- "Request a feature" entry. Free-form product feedback that an operator
-- triages from the admin Feedback tab. Mirrors the brand_requests table.

create table if not exists public.feature_requests (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  -- Denormalised requester identity so an operator can follow up without a
  -- join. `requested_by` is nullable for resilience (e.g. a since-deleted
  -- account); `requester_email` is captured at submit time.
  requested_by uuid references auth.users(id) on delete set null,
  requester_email text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

-- The admin block lists pending requests newest-first.
create index if not exists feature_requests_status_created_idx
  on public.feature_requests (status, created_at desc);

alter table public.feature_requests enable row level security;

-- Inserts arrive through a server route using the service-role key, so
-- service_role needs full access.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'feature_requests' and policyname = 'service_role_full_access_feature_requests'
  ) then
    create policy service_role_full_access_feature_requests
    on public.feature_requests
    for all
    to service_role
    using (true)
    with check (true);
  end if;
end $$;

-- Admins read and triage requests from the dashboard.
drop policy if exists feature_requests_admin_all on public.feature_requests;
create policy feature_requests_admin_all
on public.feature_requests
for all
to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

grant select, insert, update, delete on public.feature_requests to authenticated;
