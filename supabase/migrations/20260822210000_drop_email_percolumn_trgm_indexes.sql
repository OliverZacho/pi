-- Drop the per-column trigram indexes superseded by search_text.
--
-- Since 20260822200000 every email search runs against the normalized
-- `search_text` column and its GIN index; nothing queries subject /
-- preheader / primary_cta_text / plain_text with pattern operators any
-- more (verified in prod before dropping). The plain_text index alone was
-- 54MB and taxed every UPDATE on captured_emails with trigram extraction
-- over full email bodies.
--
-- promo_code's trigram index stays: promo code lookups don't go through
-- search_text.

drop index if exists public.captured_emails_subject_trgm_idx;
drop index if exists public.captured_emails_preheader_trgm_idx;
drop index if exists public.captured_emails_primary_cta_text_trgm_idx;
drop index if exists public.captured_emails_plain_text_trgm_idx;
