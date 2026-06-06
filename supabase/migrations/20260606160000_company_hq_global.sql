-- Brand-level HQ / "global brand" resolution.
--
-- Per-email text classification can't read an address that lives in a footer
-- *image*, and can't tell a genuinely global brand (H&M, Coca-Cola, Nike) apart
-- from a national brand that merely writes in English (Gisou → NL). A
-- brand-level Sonnet + web-search pass (see lib/brand-hq-lookup.ts) fills that
-- gap, so we record where its answer came from and let it carry a `global`
-- bucket alongside the per-country values.
--
-- Policy: a non-English email signal (a localized list) always wins and is
-- country-specific; the web answer is only used when the email signal is
-- English / ambiguous / unknown. `market_source` records which won.

alter table public.companies
  -- True when the brand has no single home market (region-agnostic English).
  add column if not exists is_global boolean not null default false,
  -- Web-derived HQ country (ISO 3166-1 alpha-2). Kept even for global brands
  -- (e.g. H&M -> SE) for reference; null when unknown.
  add column if not exists hq_country text,
  -- Where the committed primary_market_country came from: the email rollup or
  -- the web lookup. Null for brands not yet resolved by either.
  add column if not exists market_source text,
  add column if not exists market_resolved_at timestamptz,
  -- Audit payload for the web answer: { reasoning, sources: [{title, url}] }.
  add column if not exists market_citation jsonb;

alter table public.companies
  add constraint companies_hq_country_format
    check (hq_country is null or hq_country ~ '^[A-Z]{2}$');

alter table public.companies
  add constraint companies_market_source_check
    check (market_source is null or market_source in ('email', 'web'));

create index if not exists companies_is_global_idx
  on public.companies (is_global)
  where is_global = true;
