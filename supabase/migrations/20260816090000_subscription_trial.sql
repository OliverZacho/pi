-- ============================================================
-- Free-trial marker on subscriptions.
--
-- Solo checkout now opens with a 14-day Stripe trial (`trial_period_days`),
-- so the subscription arrives in status 'trialing' with the card already on
-- file and converts to 'active' by itself. `has_archive_access()` has always
-- admitted 'trialing', so entitlement needs no change here.
--
-- What this column adds is the "one trial per account" rule: the webhook
-- stamps it the first time Stripe reports a subscription that started with a
-- trial, and checkout refuses to offer a second one. It is deliberately a
-- timestamp rather than a boolean so we can answer "when did they trial?" in
-- the admin metrics later.
--
-- Never cleared: the row survives cancellation (nothing deletes a
-- subscriptions row), so a cancel/re-subscribe loop cannot mint a new trial.
-- ============================================================

alter table public.subscriptions
  add column if not exists trial_started_at timestamptz;

comment on column public.subscriptions.trial_started_at is
  'When this account''s first Stripe trial began. Non-null means the one free trial has been used; never cleared.';
