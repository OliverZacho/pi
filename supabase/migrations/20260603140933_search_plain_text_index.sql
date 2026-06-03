-- Pirol — extend search to the email body (`plain_text`).
--
-- Explore search and rule-based collections previously matched only
-- subject / preheader / primary CTA text (plus brand name). Campaigns that
-- only mention a term in the body copy — e.g. "3daysofdesign" appearing in a
-- Louis Poulsen newsletter body but not its subject — slipped through.
--
-- We now also ILIKE against `plain_text`. To keep `ILIKE '%foo%'` fast on the
-- (much larger) body column as the table grows, add a GIN trigram index that
-- matches the ones already backing subject / preheader / primary_cta_text.

create extension if not exists pg_trgm;

create index if not exists captured_emails_plain_text_trgm_idx
  on public.captured_emails using gin (plain_text gin_trgm_ops)
  where plain_text is not null;
