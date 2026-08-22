-- One-shot ledger for the "your trial is about to end" email. Stamped when
-- the reminder is actually sent (Stripe's customer.subscription.trial_will_end
-- event, ~3 days before the first charge) so webhook redeliveries can never
-- send it twice. Never cleared: like trial_started_at, one per account.
alter table public.subscriptions
  add column if not exists trial_reminder_sent_at timestamptz;
