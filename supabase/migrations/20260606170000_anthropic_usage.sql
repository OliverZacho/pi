-- Anthropic API usage + cost tracking.
--
-- Every call site (lib/classify.ts, lib/suggest-companies.ts,
-- lib/brand-hq-lookup.ts, lib/vision-classify.ts) talks to /v1/messages and
-- throws away the `usage` block the API returns. This table captures it so the
-- admin dashboard can show what we are actually spending on Claude. Cost is
-- computed at insert time from a pricing snapshot (see lib/anthropic-usage.ts)
-- and frozen on the row, so a future price change never silently rewrites
-- historical spend.
--
-- Rows are written by the ingest/admin paths via the service-role client, so
-- inserts bypass RLS. Admins read aggregates through
-- pirol_admin_dashboard_stats() below.

create table if not exists public.anthropic_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Which call site spent the tokens.
  feature text not null check (feature in ('classify', 'suggest', 'hq_lookup', 'vision')),
  -- Resolved model id (e.g. claude-haiku-4-5), as sent to the API.
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  -- server_tool_use.web_search_requests for the web-search-enabled call sites.
  web_search_requests integer not null default 0,
  -- USD cost frozen from the pricing snapshot at insert time.
  cost_usd numeric(12, 6) not null default 0,
  -- False when the call errored but we still saw a usage block.
  success boolean not null default true,
  metadata jsonb
);

create index if not exists anthropic_usage_created_at_idx
  on public.anthropic_usage (created_at desc);
create index if not exists anthropic_usage_feature_idx
  on public.anthropic_usage (feature);

alter table public.anthropic_usage enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'anthropic_usage'
      and policyname = 'service_role_full_access_anthropic_usage'
  ) then
    create policy service_role_full_access_anthropic_usage
    on public.anthropic_usage
    for all
    to service_role
    using (true)
    with check (true);
  end if;
end $$;

drop policy if exists anthropic_usage_admin_select on public.anthropic_usage;
create policy anthropic_usage_admin_select
on public.anthropic_usage
for select
to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

grant select, insert on public.anthropic_usage to authenticated;
grant select, insert on public.anthropic_usage to service_role;

-- Single-call dashboard rollup. Runs as the caller (security invoker), so the
-- existing admin RLS on companies / captured_emails / anthropic_usage is what
-- gates access — a non-admin gets empty/zero results, never another tenant's.
create or replace function public.pirol_admin_dashboard_stats()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'companies', (select count(*) from companies where deleted_at is null),
      'emails', (select count(*) from captured_emails)
    ),
    'velocity', jsonb_build_object(
      'emails_7d', (select count(*) from captured_emails
                    where received_at >= now() - interval '7 days'),
      'emails_30d', (select count(*) from captured_emails
                     where received_at >= now() - interval '30 days')
    ),
    'brands', jsonb_build_object(
      'total', (select count(*) from companies where deleted_at is null),
      'active_30d', (
        select count(distinct ce.company_id)
        from captured_emails ce
        where ce.company_id is not null
          and ce.received_at >= now() - interval '30 days'
      ),
      'top', coalesce((
        select jsonb_agg(t)
        from (
          select c.name as name, count(ce.id) as count
          from captured_emails ce
          join companies c on c.id = ce.company_id
          where c.deleted_at is null
          group by c.id, c.name
          order by count(ce.id) desc
          limit 5
        ) t
      ), '[]'::jsonb)
    ),
    'categories', coalesce((
      select jsonb_agg(t order by t.count desc)
      from (
        select category, count(*) as count
        from captured_emails
        group by category
      ) t
    ), '[]'::jsonb),
    'discount', jsonb_build_object(
      'avg_sale_discount', (
        select round(avg(discount_percent)::numeric, 1)
        from captured_emails
        where category = 'sale' and discount_percent is not null
      ),
      'sale_count_with_discount', (
        select count(*) from captured_emails
        where category = 'sale' and discount_percent is not null
      )
    ),
    'cost', jsonb_build_object(
      'total_usd', coalesce((select sum(cost_usd) from anthropic_usage), 0),
      'total_calls', (select count(*) from anthropic_usage),
      'last_30d_usd', coalesce((
        select sum(cost_usd) from anthropic_usage
        where created_at >= now() - interval '30 days'
      ), 0),
      'input_tokens', coalesce((select sum(input_tokens) from anthropic_usage), 0),
      'output_tokens', coalesce((select sum(output_tokens) from anthropic_usage), 0),
      'cache_read_tokens', coalesce((select sum(cache_read_input_tokens) from anthropic_usage), 0),
      'cache_creation_tokens', coalesce((select sum(cache_creation_input_tokens) from anthropic_usage), 0),
      'web_search_requests', coalesce((select sum(web_search_requests) from anthropic_usage), 0),
      'tracking_since', (select min(created_at) from anthropic_usage),
      'by_feature', coalesce((
        select jsonb_agg(t order by t.usd desc)
        from (
          select feature, sum(cost_usd) as usd, count(*) as calls
          from anthropic_usage group by feature
        ) t
      ), '[]'::jsonb),
      'by_model', coalesce((
        select jsonb_agg(t order by t.usd desc)
        from (
          select model, sum(cost_usd) as usd, count(*) as calls
          from anthropic_usage group by model
        ) t
      ), '[]'::jsonb),
      'daily_14d', coalesce((
        select jsonb_agg(t order by t.day)
        from (
          select (created_at at time zone 'UTC')::date as day, sum(cost_usd) as usd
          from anthropic_usage
          where created_at >= now() - interval '14 days'
          group by 1
        ) t
      ), '[]'::jsonb)
    )
  );
$$;

grant execute on function public.pirol_admin_dashboard_stats() to authenticated;
grant execute on function public.pirol_admin_dashboard_stats() to service_role;
