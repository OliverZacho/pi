-- Average send frequency per (category, country) for the admin dashboard.
--
-- Same per-brand cadence estimate as pirol_admin_category_frequency
-- (rate = (email_count - 1) / span_days, brands with 5+ captured emails only),
-- but broken out by the brand's primary market country so the dashboard can
-- compare cadence between countries inside a single category (e.g. home &
-- living in Sweden vs Denmark). Brands with no resolved country fall in the
-- "__unknown__" bucket; untagged brands in "__uncategorized__". Multi-tag
-- brands count once per tag. Security invoker, so the existing admin RLS on
-- captured_emails / companies is what gates access.

create or replace function public.pirol_admin_category_country_frequency()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with brand_stats as (
    select
      c.id,
      case
        when coalesce(array_length(c.markets, 1), 0) = 0 then array['__uncategorized__']
        else c.markets
      end as markets,
      coalesce(c.primary_market_country, '__unknown__') as country,
      count(e.id) as emails,
      min(e.received_at) as first_at,
      max(e.received_at) as last_at
    from companies c
    join captured_emails e on e.company_id = c.id
    where c.deleted_at is null
    group by c.id, c.markets, c.primary_market_country
    having count(e.id) >= 5
  ),
  per_brand as (
    select
      unnest(markets) as category,
      country,
      emails,
      extract(epoch from (last_at - first_at)) / 86400.0 as span_days
    from brand_stats
  ),
  rates as (
    select
      category,
      country,
      (emails - 1) / span_days as per_day
    from per_brand
    where span_days > 0
  ),
  by_pair as (
    select
      category,
      country,
      count(*) as brands,
      avg(per_day) * 7 as emails_per_week,
      avg(1.0 / per_day) as days_between
    from rates
    group by category, country
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'category', category,
        'country', country,
        'brands', brands,
        'emails_per_week', emails_per_week,
        'days_between', days_between
      )
      order by category, emails_per_week desc
    ),
    '[]'::jsonb
  )
  from by_pair;
$$;

grant execute on function public.pirol_admin_category_country_frequency() to authenticated;
grant execute on function public.pirol_admin_category_country_frequency() to service_role;
