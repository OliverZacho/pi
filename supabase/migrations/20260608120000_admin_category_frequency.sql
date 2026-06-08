-- Average send frequency per category for the admin dashboard chart.
--
-- For every brand with at least 5 captured emails (newly subscribed brands
-- often have a skewed cadence from the welcome series, so they are excluded),
-- we estimate a per-brand send rate from the span between its first and last
-- email: rate = (email_count - 1) / span_days. That rate is then averaged
-- across the brands in each category tag (companies.markets, exploded so a
-- multi-tag brand counts once per tag; untagged brands fall in an
-- "__uncategorized__" bucket). Powers the interactive frequency bar chart on
-- /admin. Security invoker, so the existing admin RLS on captured_emails /
-- companies is what gates access.

create or replace function public.pirol_admin_category_frequency()
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
      count(e.id) as emails,
      min(e.received_at) as first_at,
      max(e.received_at) as last_at
    from companies c
    join captured_emails e on e.company_id = c.id
    where c.deleted_at is null
    group by c.id, c.markets
    having count(e.id) >= 5
  ),
  per_brand as (
    -- One row per (brand, category). span_days is the active window; brands
    -- whose emails all share a single instant (span 0) carry no usable rate.
    select
      unnest(markets) as category,
      emails,
      extract(epoch from (last_at - first_at)) / 86400.0 as span_days
    from brand_stats
  ),
  rates as (
    select
      category,
      (emails - 1) / span_days as per_day
    from per_brand
    where span_days > 0
  ),
  by_category as (
    select
      category,
      count(*) as brands,
      avg(per_day) * 7 as emails_per_week,
      avg(1.0 / per_day) as days_between
    from rates
    group by category
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'category', category,
        'brands', brands,
        'emails_per_week', emails_per_week,
        'days_between', days_between
      )
      order by emails_per_week desc
    ),
    '[]'::jsonb
  )
  from by_category;
$$;

grant execute on function public.pirol_admin_category_frequency() to authenticated;
grant execute on function public.pirol_admin_category_frequency() to service_role;
