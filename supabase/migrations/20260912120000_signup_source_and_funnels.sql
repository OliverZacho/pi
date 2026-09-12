-- ============================================================================
-- Admin Users tab, round two:
--   * user_profiles.signup_source — which door the account came in through
--     (sign-up button, free-trial button, pricing checkout, in-app plan
--     modal, team invite). Stamped from signup metadata by the auth trigger,
--     or by /auth/callback for OAuth and invite landings.
--   * pirol_admin_user_metrics gains: onboarding outcome × activation,
--     onboarding brand requests, time to first action, upgrade prompts by
--     source, and signups by source.
-- ============================================================================

alter table public.user_profiles
  add column if not exists signup_source text
    check (signup_source in ('signup', 'trial', 'checkout', 'plan_modal', 'invite'));

-- Members who are not the owner of their team joined through an invite.
update public.user_profiles p
set signup_source = 'invite'
where p.signup_source is null
  and exists (
    select 1 from public.team_members m
    where m.user_id = p.user_id and m.role <> 'owner'
  );

-- Auth trigger: also copy a valid signup_source from the signup metadata.
create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_source text := new.raw_user_meta_data ->> 'signup_source';
begin
  insert into public.user_profiles (user_id, email, password_set_at, signup_source)
  values (
    new.id,
    coalesce(new.email, ''),
    case
      when TG_OP = 'INSERT' and (new.raw_user_meta_data ->> 'password_signup') = 'true'
        then now()
    end,
    case
      when TG_OP = 'INSERT'
        and meta_source in ('signup', 'trial', 'checkout', 'plan_modal', 'invite')
        then meta_source
    end
  )
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = now();

  if TG_OP = 'UPDATE'
     and new.encrypted_password is distinct from old.encrypted_password
     and new.encrypted_password is not null
     and new.encrypted_password <> '' then
    update public.user_profiles
      set password_set_at = now(),
          updated_at = now()
      where user_id = new.id;
  end if;

  return new;
end;
$$;

create or replace function public.pirol_admin_user_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  -- Accounts created before this never saw the onboarding modal.
  onboarding_since constant timestamptz := '2026-08-27';
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
      p.signup_source,
      p.onboarding_completed_at,
      p.onboarding_skipped_step,
      p.onboarding_role,
      p.onboarding_categories,
      p.own_brand_domain,
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
  ),
  -- Follows made on the user's own initiative: the onboarding modal batch
  -- lands within a couple of minutes of the onboarding stamp, so anything
  -- outside that window counts.
  own_follows as (
    select f.user_id, f.created_at
    from public.brand_follows f
    join public.user_profiles p on p.user_id = f.user_id
    where p.onboarding_completed_at is null
       or f.created_at > p.onboarding_completed_at + interval '2 minutes'
       or f.created_at < p.onboarding_completed_at - interval '2 minutes'
  ),
  -- First meaningful action per user: save, collection, comparison, or a
  -- follow made outside onboarding.
  first_actions as (
    select user_id, min(at) as first_at
    from (
      select user_id, saved_at as at from public.saved_emails
      union all
      select user_id, created_at from public.collections
      union all
      select user_id, created_at from public.competitor_sets
      union all
      select user_id, created_at from own_follows
    ) x
    group by user_id
  ),
  ttfa as (
    select
      r.user_id,
      -- greatest() ignores nulls, so guard it or non-actors read as minute 0.
      case
        when fa.first_at is null then null
        else greatest(0, extract(epoch from (fa.first_at - r.created_at)) / 60)
      end as minutes
    from realu r
    left join first_actions fa on fa.user_id = r.user_id
  ),
  ttfa_stats as (
    select
      count(*) as total,
      count(minutes) as acted,
      count(*) filter (where minutes is null) as never,
      count(*) filter (where minutes <= 60) as within_1h,
      count(*) filter (where minutes > 60 and minutes <= 1440) as within_24h,
      count(*) filter (where minutes > 1440 and minutes <= 10080) as within_7d,
      count(*) filter (where minutes > 10080) as later,
      percentile_cont(0.5) within group (order by minutes) as median_minutes,
      percentile_cont(0.75) within group (order by minutes) as p75_minutes
    from ttfa
  ),
  -- Onboarding modal: non-team accounts created since it launched.
  ob_cohort as (
    select
      u.*,
      case
        when u.onboarding_completed_at is null then 'pending'
        when u.onboarding_skipped_step is not null then 'skipped'
        else 'completed'
      end as outcome,
      (fa.first_at is not null) as acted,
      exists (select 1 from own_follows f where f.user_id = u.user_id) as followed_later
    from realu u
    left join first_actions fa on fa.user_id = u.user_id
    where u.created_at >= onboarding_since
  ),
  ob as (
    select
      count(*) as total,
      count(*) filter (where outcome = 'pending') as pending,
      count(*) filter (where outcome = 'completed') as completed,
      count(*) filter (where outcome = 'skipped') as skipped,
      count(*) filter (where onboarding_skipped_step = 1) as skipped_1,
      count(*) filter (where onboarding_skipped_step = 2) as skipped_2,
      count(*) filter (where onboarding_skipped_step = 3) as skipped_3,
      count(*) filter (where own_brand_domain is not null) as own_brand,
      count(*) filter (where outcome = 'completed' and is_paid) as completed_paid,
      count(*) filter (where outcome = 'skipped' and is_paid) as skipped_paid
    from ob_cohort
  ),
  ob_by_outcome as (
    select
      outcome,
      count(*) as total,
      count(*) filter (where acted) as acted,
      count(*) filter (where saves > 0) as saved_any,
      count(*) filter (where followed_later) as followed_later,
      count(*) filter (where collections > 0) as made_collection,
      count(*) filter (where last_active_at >= now() - interval '7 days') as active_7d,
      count(*) filter (where is_paid) as paid
    from ob_cohort
    group by outcome
  ),
  ob_roles as (
    select onboarding_role as role, count(*) as n
    from ob_cohort
    where onboarding_role is not null
    group by 1
  ),
  ob_categories as (
    select c as category, count(*) as n
    from ob_cohort, unnest(onboarding_categories) as c
    group by 1
    order by n desc, c
    limit 12
  ),
  ob_requests as (
    select
      count(*) as total,
      count(*) filter (where status = 'pending') as pending,
      count(*) filter (where status <> 'pending') as handled,
      count(distinct requested_by) as users
    from public.brand_requests
    where source = 'onboarding'
  ),
  -- Upgrade CTAs by source tag. `converted` = distinct clickers who hold a
  -- live subscription today (anonymous clicks count towards clicks only).
  up_clicks as (
    select
      source,
      count(*) as clicks,
      count(*) filter (where created_at >= now() - interval '30 days') as clicks_30d,
      count(distinct user_id) as users,
      count(distinct user_id) filter (
        where user_id in (select user_id from paid_users)
      ) as converted,
      max(created_at) as last_at
    from public.upgrade_clicks
    group by source
  ),
  src as (
    select
      coalesce(signup_source, 'unknown') as source,
      count(*) as total,
      count(*) filter (where created_at >= now() - interval '30 days') as last_30d,
      count(*) filter (where is_paid) as paid
    from realu
    group by 1
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
    ),
    'onboarding', jsonb_build_object(
      'since', onboarding_since,
      'total', (select total from ob),
      'pending', (select pending from ob),
      'completed', (select completed from ob),
      'skipped', (select skipped from ob),
      'completion_rate', (
        select case when (completed + skipped) > 0
          then completed::numeric / (completed + skipped)
          else null end
        from ob
      ),
      'skipped_by_step', (
        select jsonb_build_array(skipped_1, skipped_2, skipped_3) from ob
      ),
      'own_brand', (select own_brand from ob),
      'completed_paid', (select completed_paid from ob),
      'skipped_paid', (select skipped_paid from ob),
      'roles', (
        select coalesce(
          jsonb_agg(jsonb_build_object('role', role, 'count', n) order by n desc, role),
          '[]'::jsonb
        )
        from ob_roles
      ),
      'categories', (
        select coalesce(
          jsonb_agg(jsonb_build_object('category', category, 'count', n) order by n desc, category),
          '[]'::jsonb
        )
        from ob_categories
      ),
      'by_outcome', (
        select coalesce(
          jsonb_agg(jsonb_build_object(
            'outcome', outcome,
            'total', total,
            'acted', acted,
            'saved_any', saved_any,
            'followed_later', followed_later,
            'made_collection', made_collection,
            'active_7d', active_7d,
            'paid', paid
          )),
          '[]'::jsonb
        )
        from ob_by_outcome
      ),
      'requests', (
        select jsonb_build_object(
          'total', total, 'pending', pending, 'handled', handled, 'users', users
        )
        from ob_requests
      )
    ),
    'time_to_first_action', (
      select jsonb_build_object(
        'total', total,
        'acted', acted,
        'never', never,
        'within_1h', within_1h,
        'within_24h', within_24h,
        'within_7d', within_7d,
        'later', later,
        'median_minutes', median_minutes,
        'p75_minutes', p75_minutes
      )
      from ttfa_stats
    ),
    'upgrade_prompts', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'source', source,
          'clicks', clicks,
          'clicks_30d', clicks_30d,
          'users', users,
          'converted', converted,
          'last_at', last_at
        ) order by clicks desc, source),
        '[]'::jsonb
      )
      from up_clicks
    ),
    'signup_sources', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'source', source, 'total', total, 'last_30d', last_30d, 'paid', paid
        ) order by total desc, source),
        '[]'::jsonb
      )
      from src
    )
  )
  into result;

  return result;
end;
$$;

grant execute on function public.pirol_admin_user_metrics() to authenticated;
grant execute on function public.pirol_admin_user_metrics() to service_role;
