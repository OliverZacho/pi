-- Allow a hand-set primary market country.
--
-- Until now market_source was only ever 'email' (per-email rollup) or 'web'
-- (brand-level HQ lookup). The admin dashboard now lets an operator set a
-- brand's market country by hand from the "Brands missing market" drill-down,
-- so widen the check to permit 'manual'. A manual pick is authoritative and is
-- never overwritten by the automatic rollup (see lib/market-detect.ts).

alter table public.companies
  drop constraint if exists companies_market_source_check;

alter table public.companies
  add constraint companies_market_source_check
    check (market_source is null or market_source in ('email', 'web', 'manual'));
