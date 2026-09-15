-- ============================================================
-- Two follow-ups to the 2026-09-12 lost-email investigation.
--
-- 1. GIN fastupdate off for the search_text trigram index.
--    With fastupdate on, inserts append trigrams to a pending list and the
--    unlucky insert that pushes it past gin_pending_list_limit (4 MB) must
--    merge the whole list into the tree. On this instance that merge took
--    longer than the 8s statement_timeout, was cancelled, rolled back, and
--    the *next* insert tried again. Result: every captured_emails insert
--    timed out until someone ran gin_clean_pending_list() by hand (943
--    pending pages on 2026-09-12). Inbound volume is about one email a
--    minute, so paying the per-row index cost up front is the right trade.
--
-- 2. Reclaim stale 'processing' claims.
--    A processor run can die mid-batch (function time budget, deploy),
--    leaving the rows it claimed stuck in 'processing' forever. Stamp
--    claimed_at on claim and treat a 'processing' row older than ten
--    minutes as abandoned so it gets picked up again, within the same
--    three-attempt cap.
-- ============================================================

alter index public.captured_emails_search_text_trgm_idx set (fastupdate = off);

alter table public.webhook_events
  add column if not exists claimed_at timestamptz;

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
       or (
         status = 'processing'
         and attempt_count < 3
         and coalesce(claimed_at, processed_at, received_at) < now() - interval '10 minutes'
       )
    order by (status = 'received') desc, received_at asc
    limit batch_limit
    for update skip locked
  )
  update public.webhook_events as w
  set status = 'processing',
      claimed_at = now(),
      attempt_count = w.attempt_count + 1
  from claimed
  where w.id = claimed.id
  returning w.*;
end;
$function$;
