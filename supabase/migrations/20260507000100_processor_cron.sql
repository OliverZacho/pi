-- Pirol ingestion processor cron job.
-- Schedules a pg_cron task that POSTs to the Pirol Next.js app's internal
-- processor endpoint every 30 seconds. The endpoint is guarded by a shared
-- secret (INTERNAL_PROCESSOR_SECRET) and triggers webhook_events processing.
--
-- Secrets and the deployed URL are stored in Vault so they don't end up in
-- migration history. Before running this migration set both vault values:
--
--   select vault.create_secret(
--     'https://your-pirol-host.example.com/api/admin/internal/process-events',
--     'pirol_processor_url',
--     'Pirol ingestion processor endpoint'
--   );
--   select vault.create_secret(
--     'replace-with-INTERNAL_PROCESSOR_SECRET-value',
--     'pirol_processor_secret',
--     'Pirol internal processor shared secret'
--   );

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotently (re)create the schedule. Calling cron.schedule with an
-- existing job name updates the schedule and command in place on supported
-- pg_cron versions; if the version doesn't, unschedule first.
do $$
declare
  existing_jobid bigint;
begin
  select jobid into existing_jobid
  from cron.job
  where jobname = 'pirol-process-webhook-events';

  if existing_jobid is not null then
    perform cron.unschedule(existing_jobid);
  end if;

  perform cron.schedule(
    'pirol-process-webhook-events',
    '30 seconds',
    $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'pirol_processor_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'pirol_processor_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 25000
      );
    $cron$
  );
end
$$;
