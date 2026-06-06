-- Cumulative growth series for the admin dashboard chart.
--
-- Returns one row per calendar day (UTC) from the first activity to today, with
-- the running total of captured emails (by received_at) and subscribed brands
-- (by subscribed_since). Powers the interactive two-line growth chart on /admin.
-- Security invoker, so the existing admin RLS on captured_emails / companies is
-- what gates access.

create or replace function public.pirol_admin_growth_series()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select least(
      coalesce((select min(received_at) from captured_emails), now()),
      coalesce((select min(subscribed_since) from companies where deleted_at is null), now())
    )::date as start_day
  ),
  days as (
    select generate_series(
      (select start_day from bounds),
      (now() at time zone 'UTC')::date,
      interval '1 day'
    )::date as day
  ),
  email_daily as (
    select (received_at at time zone 'UTC')::date as day, count(*) as n
    from captured_emails
    group by 1
  ),
  brand_daily as (
    select (subscribed_since at time zone 'UTC')::date as day, count(*) as n
    from companies
    where deleted_at is null
    group by 1
  ),
  cumulative as (
    select
      d.day,
      sum(coalesce(e.n, 0)) over (order by d.day) as emails,
      sum(coalesce(b.n, 0)) over (order by d.day) as brands
    from days d
    left join email_daily e on e.day = d.day
    left join brand_daily b on b.day = d.day
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('day', day, 'emails', emails, 'brands', brands)
      order by day
    ),
    '[]'::jsonb
  )
  from cumulative;
$$;

grant execute on function public.pirol_admin_growth_series() to authenticated;
grant execute on function public.pirol_admin_growth_series() to service_role;
