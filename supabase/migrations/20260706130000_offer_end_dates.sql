-- Stated offer deadlines, extracted by the classifier at capture time.
--
-- Both columns are strictly additive and deliberately NOT backfilled:
--  * the product rule is "only draw a validity window the email itself
--    stated", so a null simply renders as a point-in-time send, and
--  * bulk rewrites of captured_emails balloon WAL (2026-07-06 disk
--    autoscale); historical rows gain the signal only if re-classified.
alter table public.captured_emails
  add column if not exists offer_ends_on date,
  add column if not exists offer_is_extension boolean;

comment on column public.captured_emails.offer_ends_on is
  'Last calendar day the email''s offer is stated to be valid, resolved from copy like "ends Sunday" / "48 hours only" against the send date. Null when the email states no deadline (never inferred).';

comment on column public.captured_emails.offer_is_extension is
  'True when the copy explicitly announces that an earlier deadline was extended ("sale extended", "2 more days"). Null for rows captured before this signal existed or with no offer.';
