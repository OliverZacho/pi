-- Brand market / region detection.
--
-- We compare brands against their peers on signals like send time, which only
-- makes sense within the same audience. A Danish home & living brand that sends
-- at 09:00 CET should not be benchmarked against a US brand sending at 09:00
-- EST. So we infer which country each email is *addressed to* and roll that up
-- to a primary market per brand.
--
-- Per the design discussion: currency is NOT a reliable signal (multi-currency
-- checkouts are common i18n noise). The trustworthy tells are the language of
-- the copy, the legal/postal footer (address, VAT/CVR number, +country phone),
-- and the sender domain TLD. The LLM weighs those holistically; when nothing
-- clears the confidence threshold we deliberately store NULL ("unknown") rather
-- than guess, because a wrong region poisons the comparison while an unknown one
-- simply falls back to all-regions.

-- ---------------------------------------------------------------------------
-- captured_emails: per-email detected country.
-- detected_country is ISO 3166-1 alpha-2 (uppercase) or NULL when unknown.
-- country_signals records what drove the decision so picks stay auditable.
-- ---------------------------------------------------------------------------
alter table public.captured_emails
  add column if not exists detected_country text,
  add column if not exists country_confidence numeric(4, 3),
  add column if not exists country_signals jsonb;

alter table public.captured_emails
  add constraint captured_emails_detected_country_format
    check (detected_country is null or detected_country ~ '^[A-Z]{2}$');

alter table public.captured_emails
  add constraint captured_emails_country_confidence_range
    check (country_confidence is null or (country_confidence >= 0 and country_confidence <= 1));

create index if not exists captured_emails_detected_country_idx
  on public.captured_emails (detected_country)
  where detected_country is not null;

-- ---------------------------------------------------------------------------
-- companies: brand-level primary market, rolled up from per-email detections.
-- NULL primary_market_country == "unknown / unclassified" (all-regions peer set).
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists primary_market_country text,
  add column if not exists market_confidence numeric(4, 3);

alter table public.companies
  add constraint companies_primary_market_country_format
    check (primary_market_country is null or primary_market_country ~ '^[A-Z]{2}$');

alter table public.companies
  add constraint companies_market_confidence_range
    check (market_confidence is null or (market_confidence >= 0 and market_confidence <= 1));

create index if not exists companies_primary_market_country_idx
  on public.companies (primary_market_country)
  where primary_market_country is not null;
