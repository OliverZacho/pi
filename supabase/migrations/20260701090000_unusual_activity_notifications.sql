-- Pirol — notification generalization for the "unusual sending activity"
-- alert (and future notification types).
--
-- 1. digest_sends becomes the unified per-notification send log: add a
--    notification_type so each type tracks its own window/dedup. Existing
--    rows are the "new email" digest.
-- 2. notification_alerts records which anomaly signals a user has already
--    been alerted about, so an ongoing spike or silence isn't re-sent on
--    every cadence tick (14-day cooldown enforced in the app layer).

alter table public.digest_sends
  add column if not exists notification_type text not null default 'new_email';

drop index if exists digest_sends_user_cadence_sent_idx;
create index if not exists digest_sends_user_type_cadence_sent_idx
  on public.digest_sends (user_id, notification_type, cadence, sent_at desc);

create table if not exists public.notification_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Anomaly signal: 'pace_spike' | 'gone_quiet'.
  kind text not null,
  alerted_at timestamptz not null default now()
);

create index if not exists notification_alerts_lookup_idx
  on public.notification_alerts (user_id, company_id, kind, alerted_at desc);

alter table public.notification_alerts enable row level security;

drop policy if exists notification_alerts_service_all on public.notification_alerts;
create policy notification_alerts_service_all
  on public.notification_alerts
  for all
  to service_role
  using (true)
  with check (true);
