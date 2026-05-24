-- Brands can belong to more than one market / category (e.g. "ecommerce"
-- and "fashion"). Replace the singular `companies.market` text column with
-- a `markets text[]` array so each company can carry as many tags as the
-- operator wants without us having to fan out into a separate join table
-- (we always read every market for a brand together, so co-locating them
-- on the row is the simplest indexable representation).

alter table public.companies
  add column if not exists markets text[] not null default '{}';

-- Backfill from the existing scalar column so current data is preserved.
-- We keep tags lower-cased to match the historical write path
-- (`createCompanySubscriptionInDb` always lower-cased the singular
-- value).
update public.companies
   set markets = array[lower(market)]
 where market is not null
   and market <> ''
   and (markets is null or array_length(markets, 1) is null);

-- GIN index supports `markets && '{...}'` (overlap) lookups used by the
-- explore / brands filters. `array_ops` is the right opclass for text[]
-- when we only need overlap / containment.
create index if not exists companies_markets_gin_idx
  on public.companies using gin (markets);

-- Drop the legacy singular column. All readers and writers have been
-- migrated to `markets`. Doing this in the same migration keeps the
-- application code from having to maintain two parallel columns.
alter table public.companies
  drop column if exists market;
