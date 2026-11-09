-- ---------------------------------------------------------------------------
-- Brand campaign stats: read a stored copy instead of the live view.
--
-- public.brand_campaign_stats (20260924120000_brand_claim_facts.sql) was meant
-- to make a brand page "two keyed lookups". It is not: its `campaigns` CTE is
-- referenced six times, so Postgres materialises it, and the company_id filter
-- is applied after. Every read scans every captured email and spills to temp
-- files, for one brand's row. Measured on 2026-11-09 with 19.8k emails: about
-- half a second for one brand on an idle database, 4 seconds under ordinary
-- load, and 19 to 26 seconds when five ran at once. That last case took every
-- other query down with it for 20 seconds (logins included) and timed six out.
-- brand_benchmark_pool and brand_category_benchmarks sit on the same view and
-- pay the same scan.
--
-- The whole view for every brand takes about 4.6 seconds, so it is computed
-- once on a schedule and stored. Readers get an index lookup.
--
-- Trade-off: the facts behind a brand's generated narrative lag a new email by
-- up to 30 minutes. The narrative is cached for an hour in the app anyway.
-- ---------------------------------------------------------------------------

create materialized view if not exists public.brand_campaign_stats_snapshot as
select * from public.brand_campaign_stats
with data;

-- Required for REFRESH ... CONCURRENTLY, and it is the lookup key.
create unique index if not exists brand_campaign_stats_snapshot_company_id_key
  on public.brand_campaign_stats_snapshot (company_id);

-- A materialised view has no row-level security and ignores security_invoker,
-- so the grant is the only gate. The live view let subscribers through their
-- RLS on captured_emails; nothing in the app reads these as a subscriber (the
-- brand page uses the service role), so the stored copy is service-role only.
revoke all on public.brand_campaign_stats_snapshot from public, anon, authenticated;
grant select on public.brand_campaign_stats_snapshot to service_role;

-- ---------------------------------------------------------------------------
-- The benchmark pool, unchanged except that it reads the snapshot. The
-- category medians view is built on the pool and follows without edits.
-- ---------------------------------------------------------------------------
create or replace view public.brand_benchmark_pool
with (security_invoker = true) as
select
  s.company_id,
  coalesce(c.markets[1], '(none)') as category,
  s.campaigns,
  s.span_days,
  s.discount_count,
  s.max_discount,
  (s.campaigns::numeric / greatest(s.span_days, 1) * 7)::double precision as per_week,
  (s.discount_count::numeric / s.campaigns)::double precision as discount_share,
  rank() over (
    partition by coalesce(c.markets[1], '(none)')
    order by s.campaigns::numeric / greatest(s.span_days, 1) desc
  )::int as rank_per_week
from public.brand_campaign_stats_snapshot s
join public.companies c on c.id = s.company_id
join public.company_email_stats es on es.company_id = c.id
where c.deleted_at is null
  and es.email_count >= 5
  and s.campaigns >= 5
  and s.span_days >= 14;

-- These two are security_invoker views over a service-role-only relation now,
-- so a subscriber's read would fail on the snapshot. Drop the grant rather
-- than leave one that cannot work.
revoke all on public.brand_benchmark_pool from public, anon, authenticated;
revoke all on public.brand_category_benchmarks from public, anon, authenticated;
grant select on public.brand_benchmark_pool to service_role;
grant select on public.brand_category_benchmarks to service_role;

-- ---------------------------------------------------------------------------
-- Refresh twice an hour, off the :05 Black Friday snapshot. CONCURRENTLY keeps
-- the old rows readable while the new ones are computed.
-- ---------------------------------------------------------------------------
do $$
declare
  existing_jobid bigint;
begin
  select jobid into existing_jobid
  from cron.job where jobname = 'pirol-brand-campaign-stats-snapshot';
  if existing_jobid is not null then
    perform cron.unschedule(existing_jobid);
  end if;
  perform cron.schedule('pirol-brand-campaign-stats-snapshot', '20,50 * * * *',
    'refresh materialized view concurrently public.brand_campaign_stats_snapshot');
end
$$;
