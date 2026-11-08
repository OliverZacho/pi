-- Keep pg_cron's run log to 7 days.
--
-- cron.job_run_details records every run of every job and pg_cron never
-- prunes it. With two jobs firing every 30 seconds it had grown to 529k
-- rows / 832 MB by 2026-11-08, over a third of the whole database (purged
-- and VACUUM FULLed by hand that day). This nightly job keeps it bounded at
-- roughly a week of history (~25k rows, ~15 MB).
--
-- net._http_response needs no job: pg_net deletes its own responses after
-- 6 hours. Plain autovacuum keeps reusing that space now that it has been
-- compacted once.

select cron.unschedule('purge-cron-run-history')
where exists (select 1 from cron.job where jobname = 'purge-cron-run-history');

select cron.schedule(
  'purge-cron-run-history',
  '17 3 * * *',
  $cron$
    delete from cron.job_run_details
    where end_time < now() - interval '7 days'
  $cron$
);
