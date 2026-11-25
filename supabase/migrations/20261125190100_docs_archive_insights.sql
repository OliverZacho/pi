-- ---------------------------------------------------------------------------
-- /docs archive insights: read a stored per-brand summary, never the emails.
--
-- lib/docs/insights.ts computed its benchmarks (ESP share, send hour, cadence,
-- discounts, content mix) from the newest 40,000 de-duplicated sends, pulled
-- out through PostgREST as ~22 parallel 1,000-row pages with growing offsets.
-- Each refresh (every 30 minutes per insight, on whichever visit found the
-- cache expired, and ~10 at once after every deploy) took 13 to 19 seconds per
-- page on 2026-11-25 and queued everything else behind it: an ingest insert
-- took 22 s and explore_facets hit its statement timeout.
--
-- Every one of those benchmarks only needs per-brand totals, so this stores
-- them (~620 rows) and refreshes on a schedule. The request path reads the
-- summary in one call and never touches captured_emails.
--
-- Send hours are bucketed in Europe/Copenhagen, the app's PLATFORM_TIMEZONE
-- (lib/datetime.ts). Change both together.
--
-- Trade-off: the docs figures can lag new email by up to 30 minutes (they
-- were already cached for 30).
-- ---------------------------------------------------------------------------

create materialized view if not exists public.docs_brand_insight_stats as
with sample as (
  -- Same slice the app used: newest de-duplicated sends, capped, then only
  -- those attributed to a brand. Index-only via
  -- captured_emails_insight_sample_idx.
  select
    e.company_id,
    e.received_at,
    e.esp_provider,
    case
      when e.discount_percent > 0 and e.discount_percent <= 100
        then e.discount_percent
    end as discount,
    coalesce(e.category, '') as category
  from public.captured_emails e
  where e.duplicate_of is null
  order by e.received_at desc
  limit 40000
),
attributed as (
  select * from sample where company_id is not null
),
base as (
  select
    company_id,
    count(*)::integer as sends,
    count(discount)::integer as discount_sends,
    coalesce(sum(discount), 0)::double precision as discount_sum,
    coalesce(max(discount), 0)::double precision as discount_max,
    min(received_at) as first_at,
    max(received_at) as last_at
  from attributed
  group by company_id
),
esps as (
  select company_id, jsonb_object_agg(esp_provider, n) as esp_counts
  from (
    select company_id, esp_provider, count(*)::integer as n
    from attributed
    where esp_provider is not null
    group by 1, 2
  ) x
  group by company_id
),
hours as (
  select company_id, jsonb_object_agg(hour, n) as hour_counts
  from (
    select
      company_id,
      extract(hour from received_at at time zone 'Europe/Copenhagen')::integer as hour,
      count(*)::integer as n
    from attributed
    group by 1, 2
  ) x
  group by company_id
),
cats as (
  select company_id, jsonb_object_agg(category, n) as category_counts
  from (
    select company_id, category, count(*)::integer as n
    from attributed
    where category <> ''
    group by 1, 2
  ) x
  group by company_id
)
select
  b.company_id,
  b.sends,
  b.discount_sends,
  b.discount_sum,
  b.discount_max,
  b.first_at,
  b.last_at,
  coalesce(esps.esp_counts, '{}'::jsonb) as esp_counts,
  coalesce(hours.hour_counts, '{}'::jsonb) as hour_counts,
  coalesce(cats.category_counts, '{}'::jsonb) as category_counts
from base b
left join esps using (company_id)
left join hours using (company_id)
left join cats using (company_id)
with data;

-- Required for REFRESH ... CONCURRENTLY.
create unique index if not exists docs_brand_insight_stats_company_id_key
  on public.docs_brand_insight_stats (company_id);

-- No row-level security on a materialised view, so the grant is the gate.
revoke all on public.docs_brand_insight_stats from public, anon, authenticated;
grant select on public.docs_brand_insight_stats to service_role;

-- One call for everything the docs need: the per-brand summary plus the live
-- brands' industry tags. A single jsonb value, so PostgREST's 1,000-row cap
-- can't truncate either list (there are already ~690 live brands).
create or replace function public.docs_archive_insights()
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'markets', c.markets,
        'country', c.primary_market_country
      ))
      from public.companies c
      where c.deleted_at is null
    ), '[]'::jsonb),
    'brands', coalesce((
      select jsonb_agg(to_jsonb(s))
      from public.docs_brand_insight_stats s
    ), '[]'::jsonb)
  )
$fn$;

revoke all on function public.docs_archive_insights() from public, anon, authenticated;
grant execute on function public.docs_archive_insights() to service_role;

-- Refresh twice an hour, clear of the other snapshots (:05 black friday,
-- :20/:50 campaign stats, :25/:55 send stats) so they never compute together.
do $$
declare
  existing_jobid bigint;
begin
  select jobid into existing_jobid
  from cron.job where jobname = 'pirol-docs-insight-stats';
  if existing_jobid is not null then
    perform cron.unschedule(existing_jobid);
  end if;
  perform cron.schedule('pirol-docs-insight-stats', '12,42 * * * *',
    'refresh materialized view concurrently public.docs_brand_insight_stats');
end
$$;
