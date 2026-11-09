-- ---------------------------------------------------------------------------
-- Brand send stats: read a stored copy instead of the live view.
--
-- public.brand_send_stats (20260704120000_brand_send_stats.sql) walks every
-- captured email on each read. Measured on 2026-11-09 with 19.8k emails: 1 to
-- 6 seconds on an idle database. The /brands catalogue hides that behind a
-- daily app cache, but a deploy empties the cache and concurrent misses are
-- not deduplicated: right after a deploy that evening, five rebuilds ran the
-- view together and took 10 to 11 seconds each. The same view took 26 seconds
-- during the stall that 20261109200000_brand_campaign_stats_snapshot.sql
-- fixed. It is computed once on a schedule instead.
--
-- Trade-off: a brand's ESP and cadence on the directory and the following grid
-- can lag a new email by up to 30 minutes (the directory already allows a day).
-- ---------------------------------------------------------------------------

create materialized view if not exists public.brand_send_stats_snapshot as
select * from public.brand_send_stats
with data;

-- Required for REFRESH ... CONCURRENTLY, and it is the lookup key.
create unique index if not exists brand_send_stats_snapshot_company_id_key
  on public.brand_send_stats_snapshot (company_id);

-- No row-level security on a materialised view, so the grant is the gate.
-- The app reads it through the service role only; the numbers themselves are
-- already public on the logged-out directory.
revoke all on public.brand_send_stats_snapshot from public, anon, authenticated;
grant select on public.brand_send_stats_snapshot to service_role;

-- Refresh twice an hour, five minutes after the campaign stats snapshot so the
-- two never compute together.
do $$
declare
  existing_jobid bigint;
begin
  select jobid into existing_jobid
  from cron.job where jobname = 'pirol-brand-send-stats-snapshot';
  if existing_jobid is not null then
    perform cron.unschedule(existing_jobid);
  end if;
  perform cron.schedule('pirol-brand-send-stats-snapshot', '25,55 * * * *',
    'refresh materialized view concurrently public.brand_send_stats_snapshot');
end
$$;
