-- ============================================================
-- Retry failed webhook events instead of stranding them.
--
-- `claim_webhook_events` only ever picked up `status = 'received'`, so an
-- event whose processing failed (e.g. the captured_emails insert hitting
-- the 8s statement timeout during a GIN pending-list flush) stayed
-- `failed` forever with attempt_count = 1. 368 inbound emails were lost
-- that way between 2026-07-06 and 2026-09-12.
--
-- Now a failed event is claimable again once it has cooled off for two
-- minutes, up to three attempts in total. Fresh `received` events are
-- always claimed ahead of retries so a backlog of retries never delays
-- live capture.
-- ============================================================

create or replace function public.claim_webhook_events(batch_limit integer default 5)
returns setof public.webhook_events
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return query
  with claimed as (
    select id
    from public.webhook_events
    where status = 'received'
       or (
         status = 'failed'
         and attempt_count < 3
         and coalesce(processed_at, received_at) < now() - interval '2 minutes'
       )
    order by (status = 'received') desc, received_at asc
    limit batch_limit
    for update skip locked
  )
  update public.webhook_events as w
  set status = 'processing',
      attempt_count = w.attempt_count + 1
  from claimed
  where w.id = claimed.id
  returning w.*;
end;
$function$;

-- The existing webhook_events (status, received_at) index from
-- 20260507000000_harden_ingestion covers the widened claim filter.
