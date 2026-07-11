create or replace function public.pirol_admin_user_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.admin_users where user_id = auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with
  admins as (select user_id from public.admin_users),
  paid_users as (
    select user_id
    from public.subscriptions
    where status in ('active', 'trialing')
      and (current_period_end is null or current_period_end > now())
  ),
  saves as (select user_id, count(*) as n from public.saved_emails group by 1),
  colls as (select user_id, count(*) as n from public.collections group by 1),
  users as (
    select
      p.user_id,
      p.created_at,
      p.last_active_at,
      (a.user_id is not null) as is_admin,
      (pd.user_id is not null) as is_paid,
      coalesce(s.n, 0) as saves,
      coalesce(c.n, 0) as collections
    from public.user_profiles p
    left join admins a on a.user_id = p.user_id
    left join paid_users pd on pd.user_id = p.user_id
    left join saves s on s.user_id = p.user_id
    left join colls c on c.user_id = p.user_id
  ),
  realu as (select * from users where not is_admin),
  rs as (
    select
      count(*) as total,
      count(*) filter (where last_active_at >= now() - interval '1 day') as dau,
      count(*) filter (where last_active_at >= now() - interval '7 days') as wau,
      count(*) filter (where last_active_at >= now() - interval '30 days') as mau,
      count(*) filter (where last_active_at >= now() - interval '7 days') as r_active,
      count(*) filter (
        where last_active_at < now() - interval '7 days'
          and last_active_at >= now() - interval '30 days'
      ) as r_recent,
      count(*) filter (
        where last_active_at < now() - interval '30 days'
          and last_active_at >= now() - interval '60 days'
      ) as r_at_risk,
      count(*) filter (where last_active_at < now() - interval '60 days') as r_dormant,
      count(*) filter (where last_active_at is null) as r_never,
      count(*) filter (where last_active_at is not null) as onboarded,
      count(*) filter (
        where last_active_at is not null and last_active_at < now() - interval '30 days'
      ) as inactive_30d,
      count(*) filter (where saves > 0 or collections > 0) as activated,
      count(*) filter (where saves >= 5) as power_users,
      count(*) filter (where saves > 0) as saved_any,
      count(*) filter (where collections > 0) as made_collection,
      count(*) filter (where is_paid) as paid
    from realu
  ),
  tiers as (
    select
      count(*) as total,
      count(*) filter (where is_admin) as admins,
      count(*) filter (where is_paid and not is_admin) as paid,
      count(*) filter (where not is_admin and not is_paid) as free
    from users
  ),
  subs as (
    select
      count(*) filter (
        where status in ('active', 'trialing')
          and (current_period_end is null or current_period_end > now())
      ) as active,
      count(*) filter (
        where status not in ('active', 'trialing')
          or (current_period_end is not null and current_period_end <= now())
      ) as canceled
    from public.subscriptions
  ),
  bounds as (
    select coalesce((select min(created_at) from public.user_profiles), now())::date as start_day
  ),
  days as (
    select generate_series(
      (select start_day from bounds),
      (now() at time zone 'UTC')::date,
      interval '1 day'
    )::date as day
  ),
  signup_daily as (
    select (created_at at time zone 'UTC')::date as day, count(*) as n
    from public.user_profiles
    group by 1
  ),
  paid_daily as (
    select (created_at at time zone 'UTC')::date as day, count(*) as n
    from public.subscriptions
    where status in ('active', 'trialing')
    group by 1
  ),
  growth_cum as (
    select
      d.day,
      sum(coalesce(s.n, 0)) over (order by d.day) as users,
      sum(coalesce(p.n, 0)) over (order by d.day) as paid
    from days d
    left join signup_daily s on s.day = d.day
    left join paid_daily p on p.day = d.day
  ),
  new_windows as (
    select
      count(*) filter (where created_at >= now() - interval '30 days') as new_30d,
      count(*) filter (
        where created_at < now() - interval '30 days'
          and created_at >= now() - interval '60 days'
      ) as new_prev_30d
    from public.user_profiles
  )
  select jsonb_build_object(
    'generated_at', now(),
    'totals', jsonb_build_object(
      'total', (select total from tiers),
      'free', (select free from tiers),
      'paid', (select paid from tiers),
      'admins', (select admins from tiers)
    ),
    'growth', jsonb_build_object(
      'new_30d', (select new_30d from new_windows),
      'new_prev_30d', (select new_prev_30d from new_windows),
      'growth_rate_30d', (
        select case when nw.new_prev_30d > 0
          then (nw.new_30d - nw.new_prev_30d)::numeric / nw.new_prev_30d
          else null end
        from new_windows nw
      ),
      'series', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object('day', day, 'users', users, 'paid', paid)
            order by day
          ),
          '[]'::jsonb
        )
        from growth_cum
      )
    ),
    'retention', jsonb_build_object(
      'real_total', (select total from rs),
      'onboarded', (select onboarded from rs),
      'active_7d', (select r_active from rs),
      'recent', (select r_recent from rs),
      'at_risk', (select r_at_risk from rs),
      'dormant', (select r_dormant from rs),
      'never_onboarded', (select r_never from rs),
      'inactive_rate_30d', (
        select case when onboarded > 0 then inactive_30d::numeric / onboarded else null end from rs
      )
    ),
    'subscription', jsonb_build_object(
      'active', (select active from subs),
      'canceled', (select canceled from subs),
      'churn_rate', (
        select case when (active + canceled) > 0
          then canceled::numeric / (active + canceled)
          else null end
        from subs
      )
    ),
    'pmf', jsonb_build_object(
      'activated', (select activated from rs),
      'activation_rate', (
        select case when total > 0 then activated::numeric / total else null end from rs
      ),
      'power_users', (select power_users from rs),
      'power_user_rate', (
        select case when total > 0 then power_users::numeric / total else null end from rs
      ),
      'dau', (select dau from rs),
      'wau', (select wau from rs),
      'mau', (select mau from rs),
      'stickiness', (
        select case when mau > 0 then dau::numeric / mau else null end from rs
      )
    ),
    'funnel', jsonb_build_array(
      jsonb_build_object('key', 'signed_up', 'label', 'Signed up', 'count', (select total from rs)),
      jsonb_build_object('key', 'active_30d', 'label', 'Active (30d)', 'count', (select mau from rs)),
      jsonb_build_object('key', 'saved', 'label', 'Saved an email', 'count', (select saved_any from rs)),
      jsonb_build_object('key', 'collection', 'label', 'Built a collection', 'count', (select made_collection from rs)),
      jsonb_build_object('key', 'paid', 'label', 'Upgraded to paid', 'count', (select paid from rs))
    )
  )
  into result;

  return result;
end;
$$;

grant execute on function public.pirol_admin_user_metrics() to authenticated;
grant execute on function public.pirol_admin_user_metrics() to service_role;
