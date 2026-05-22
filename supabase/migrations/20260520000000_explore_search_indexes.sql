-- Pirol — Explore search & filter indexes.
--
-- The Explore grid moved from in-memory filtering (over the last 36 rows) to
-- server-side search across the whole `captured_emails` table. The search box
-- matches subject / preheader / promo code / primary CTA text on the email
-- itself, plus the brand name from `companies`. To keep those ILIKE queries
-- fast as the table grows we install `pg_trgm` and create GIN trigram
-- indexes on the searched columns.
--
-- Trigram indexes work with `ILIKE '%foo%'` and `% '%foo%'` similarity
-- queries; they're the standard solution for substring search in Postgres
-- when full-text ranking would be overkill (no ranking / typo tolerance
-- needed here, just "find anything containing this fragment").

create extension if not exists pg_trgm;

create index if not exists captured_emails_subject_trgm_idx
  on public.captured_emails using gin (subject gin_trgm_ops);

create index if not exists captured_emails_preheader_trgm_idx
  on public.captured_emails using gin (preheader gin_trgm_ops)
  where preheader is not null;

create index if not exists captured_emails_primary_cta_text_trgm_idx
  on public.captured_emails using gin (primary_cta_text gin_trgm_ops)
  where primary_cta_text is not null;

create index if not exists captured_emails_promo_code_trgm_idx
  on public.captured_emails using gin (promo_code gin_trgm_ops)
  where promo_code is not null;

create index if not exists companies_name_trgm_idx
  on public.companies using gin (name gin_trgm_ops);
