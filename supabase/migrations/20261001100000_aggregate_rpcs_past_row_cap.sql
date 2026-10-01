-- ---------------------------------------------------------------------------
-- Aggregations that used to scan rows into the app.
--
-- PostgREST caps every response at 1,000 rows whatever `.limit()` asks for,
-- and truncates silently. Each function below replaces an app-side scan that
-- only existed to aggregate, and that had been reading a 1,000-row slice of
-- the table without anyone noticing. Every one returns a handful of rows (or
-- one jsonb document), so the cap can't bite again as the tables grow.
--
-- All are security invoker: callers keep whatever RLS they had before. The
-- click tables are service-role only, so those functions are too.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Cohort send benchmark (/api/explore/brand-insight).
--
-- Average weekly send rate and discount share across a cohort: the brands
-- tagged with any of `p_markets` when there are at least 8 of them, else every
-- tracked brand. A brand needs 4 canonical sends to count, and its active span
-- is clamped to at least 7 days so a short burst doesn't read as a high rate.
-- ---------------------------------------------------------------------------
create or replace function public.brand_cohort_benchmark(p_markets text[] default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  with market_cohort as (
    select id
    from companies
    where deleted_at is null
      and coalesce(cardinality(p_markets), 0) > 0
      and markets && p_markets
  ),
  scope as (
    select (select count(*) from market_cohort) >= 8 as is_market
  ),
  cohort as (
    select id from market_cohort where (select is_market from scope)
    union all
    select id from companies
    where deleted_at is null and not (select is_market from scope)
  ),
  per_brand as (
    select
      count(*) as n,
      count(*) filter (where e.discount_percent > 0) as disc,
      extract(epoch from max(e.received_at) - min(e.received_at)) / 86400.0 as span_days
    from captured_emails e
    join cohort c on c.id = e.company_id
    where e.duplicate_of is null
    group by e.company_id
    having count(*) >= 4
  )
  select jsonb_build_object(
    'scope', case when (select is_market from scope) then 'category' else 'all' end,
    'brands', count(*),
    'per_week', avg(7.0 * n / greatest(7, span_days)),
    'discount_share', avg(100.0 * disc / n)
  )
  from per_brand;
$$;

revoke all on function public.brand_cohort_benchmark(text[]) from public, anon, authenticated;
grant execute on function public.brand_cohort_benchmark(text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 2. ESP cohort (/api/explore/brand-insight).
--
-- Each brand's most-used ESP across its canonical sends (ties broken by name,
-- so the answer is stable), then how many brands sit on each ESP. Cohort is
-- every tracked brand, narrowed by market overlap and primary country when
-- given. `companies` is the cohort size before the ESP filter, so the caller
-- can decide whether there are enough peers.
-- ---------------------------------------------------------------------------
create or replace function public.esp_cohort_shares(
  p_markets text[] default null,
  p_country text default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with cohort as (
    select id
    from companies
    where deleted_at is null
      and (p_markets is null or markets && p_markets)
      and (p_country is null or primary_market_country = p_country)
  ),
  counts as (
    select e.company_id, e.esp_provider, count(*) as n
    from captured_emails e
    join cohort c on c.id = e.company_id
    where e.duplicate_of is null
      and e.esp_provider is not null
    group by e.company_id, e.esp_provider
  ),
  top_esp as (
    select distinct on (company_id) company_id, esp_provider
    from counts
    order by company_id, n desc, esp_provider
  ),
  per_esp as (
    select esp_provider, count(*) as brands
    from top_esp
    group by esp_provider
  )
  select jsonb_build_object(
    'companies', (select count(*) from cohort),
    'brands', (select count(*) from top_esp),
    'items', coalesce(
      (select jsonb_agg(
         jsonb_build_object('esp', esp_provider, 'brands', brands)
         order by brands desc, esp_provider
       ) from per_esp),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.esp_cohort_shares(text[], text) from public, anon, authenticated;
grant execute on function public.esp_cohort_shares(text[], text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Deepest discount per brand since a date (collection discount figure).
--
-- Called with the viewer's own client, so it runs under their RLS exactly as
-- the row scan it replaces did.
-- ---------------------------------------------------------------------------
create or replace function public.brand_max_discounts(
  p_company_ids uuid[],
  p_since timestamptz
)
returns table (company_id uuid, company_name text, max_discount numeric)
language sql
stable
set search_path = public
as $$
  select c.id, c.name, max(e.discount_percent)::numeric
  from captured_emails e
  join companies c on c.id = e.company_id
  where e.company_id = any(p_company_ids)
    and e.received_at >= p_since
    and e.discount_percent > 0
  group by c.id, c.name;
$$;

revoke all on function public.brand_max_discounts(uuid[], timestamptz) from public, anon;
grant execute on function public.brand_max_discounts(uuid[], timestamptz)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Nav click totals per button (admin), optionally for one user.
-- ---------------------------------------------------------------------------
create or replace function public.nav_click_stats(
  p_recent_since timestamptz,
  p_user_id uuid default null
)
returns table (
  nav_id text,
  total bigint,
  recent bigint,
  unique_users bigint,
  last_click_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    nav_id,
    count(*),
    count(*) filter (where created_at >= p_recent_since),
    count(distinct user_id),
    max(created_at)
  from nav_clicks
  where p_user_id is null or user_id = p_user_id
  group by nav_id;
$$;

revoke all on function public.nav_click_stats(timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.nav_click_stats(timestamptz, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Upgrade click totals per source, plus daily (UTC) counts since a date.
-- ---------------------------------------------------------------------------
create or replace function public.upgrade_click_stats(
  p_recent_since timestamptz,
  p_daily_since timestamptz
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'sources', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'source', source,
         'total', total,
         'recent', recent,
         'last_click_at', last_click_at
       ))
       from (
         select
           source,
           count(*) as total,
           count(*) filter (where created_at >= p_recent_since) as recent,
           max(created_at) as last_click_at
         from upgrade_clicks
         group by source
       ) s),
      '[]'::jsonb
    ),
    'daily', coalesce(
      (select jsonb_agg(jsonb_build_object('date', day, 'count', n))
       from (
         select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*) as n
         from upgrade_clicks
         where created_at >= p_daily_since
         group by 1
       ) d),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.upgrade_click_stats(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.upgrade_click_stats(timestamptz, timestamptz) to service_role;
