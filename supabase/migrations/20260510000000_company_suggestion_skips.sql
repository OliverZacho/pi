-- Pirol company suggestion skips.
-- Persists the brands an admin has dismissed from the LLM suggestion pane so we
-- never propose them again, scoped by (lower(domain), coalesce(market, '')).

create table if not exists public.suggestion_skips (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  market text,
  reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists suggestion_skips_domain_market_unique
  on public.suggestion_skips (lower(domain), coalesce(lower(market), ''));

create index if not exists suggestion_skips_market_idx
  on public.suggestion_skips (lower(market))
  where market is not null;

alter table public.suggestion_skips enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'suggestion_skips' and policyname = 'service_role_full_access_suggestion_skips'
  ) then
    create policy service_role_full_access_suggestion_skips
    on public.suggestion_skips
    for all
    to service_role
    using (true)
    with check (true);
  end if;
end $$;

drop policy if exists suggestion_skips_admin_all on public.suggestion_skips;
create policy suggestion_skips_admin_all
on public.suggestion_skips
for all
to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()))
with check (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

grant select, insert, update, delete on public.suggestion_skips to authenticated;
