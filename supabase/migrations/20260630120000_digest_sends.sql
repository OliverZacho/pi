-- Pirol — editorial digest send log.
--
-- One row per (user, cadence) successful digest send. Powers two things:
--   1. The digest window — each run pulls emails received since the user's
--      last successful send for that cadence (falling back to the cadence
--      length on first run), so a missed run never drops emails and a
--      double-fire never repeats them.
--   2. Idempotency — the cron can re-run safely; a send already recorded
--      inside the current window is skipped.
--
-- Service-role only: the digest job runs as the service role; users never
-- read or write this table directly, so there are no authenticated policies.

create table if not exists public.digest_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  sent_at timestamptz not null default now(),
  -- Window covered by this send, kept for debugging / audit.
  window_start timestamptz,
  window_end timestamptz,
  -- How many new emails / brands the digest reported. A digest is never
  -- sent for a truly empty window, so email_count is always >= 1.
  email_count integer not null default 0,
  brand_count integer not null default 0,
  -- Resend message id, for deliverability tracing.
  resend_id text
);

create index if not exists digest_sends_user_cadence_sent_idx
  on public.digest_sends (user_id, cadence, sent_at desc);

alter table public.digest_sends enable row level security;

drop policy if exists digest_sends_service_all on public.digest_sends;
create policy digest_sends_service_all
  on public.digest_sends
  for all
  to service_role
  using (true)
  with check (true);
