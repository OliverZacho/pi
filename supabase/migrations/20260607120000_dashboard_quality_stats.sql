-- Add a `quality` rollup to the admin dashboard stats function so the founder
-- view can track how clean the catalog is as more brands/newsletters land:
--   * brands_unknown_market  — brands with no resolved primary market country
--   * logos_needing_review   — mirrors lib/admin-db.ts needsLogoReview: a stale
--                              manual pick, or a non-manual pick that is missing
--                              or below the 0.5 confidence floor (LOGO_REVIEW_MAX_CONFIDENCE)
--   * low_confidence_emails  — classified emails under the 0.5 confidence floor
--
-- Everything else is unchanged from 20260606170000_anthropic_usage.sql; this is
-- an additive `create or replace`.

create or replace function public.pirol_admin_dashboard_stats()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'companies', (select count(*) from companies where deleted_at is null),
      'emails', (select count(*) from captured_emails)
    ),
    'velocity', jsonb_build_object(
      'emails_7d', (select count(*) from captured_emails
                    where received_at >= now() - interval '7 days'),
      'emails_30d', (select count(*) from captured_emails
                     where received_at >= now() - interval '30 days')
    ),
    'brands', jsonb_build_object(
      'total', (select count(*) from companies where deleted_at is null),
      'active_30d', (
        select count(distinct ce.company_id)
        from captured_emails ce
        where ce.company_id is not null
          and ce.received_at >= now() - interval '30 days'
      ),
      'top', coalesce((
        select jsonb_agg(t)
        from (
          select c.name as name, count(ce.id) as count
          from captured_emails ce
          join companies c on c.id = ce.company_id
          where c.deleted_at is null
          group by c.id, c.name
          order by count(ce.id) desc
          limit 5
        ) t
      ), '[]'::jsonb)
    ),
    'categories', coalesce((
      select jsonb_agg(t order by t.count desc)
      from (
        select category, count(*) as count
        from captured_emails
        group by category
      ) t
    ), '[]'::jsonb),
    'discount', jsonb_build_object(
      'avg_sale_discount', (
        select round(avg(discount_percent)::numeric, 1)
        from captured_emails
        where category = 'sale' and discount_percent is not null
      ),
      'sale_count_with_discount', (
        select count(*) from captured_emails
        where category = 'sale' and discount_percent is not null
      )
    ),
    'quality', jsonb_build_object(
      'low_confidence_threshold', 0.5,
      'brands_unknown_market', (
        select count(*) from companies
        where deleted_at is null and primary_market_country is null
      ),
      'logos_needing_review', (
        select count(*) from companies
        where deleted_at is null
          and (
            coalesce(logo_stale, false) = true
            or (
              logo_source is distinct from 'manual'
              and (
                logo_storage_path is null
                or logo_confidence is null
                or logo_confidence < 0.5
              )
            )
          )
      ),
      'low_confidence_emails', (
        select count(*) from captured_emails
        where classification_confidence is not null
          and classification_confidence < 0.5
      )
    ),
    'cost', jsonb_build_object(
      'total_usd', coalesce((select sum(cost_usd) from anthropic_usage), 0),
      'total_calls', (select count(*) from anthropic_usage),
      'last_30d_usd', coalesce((
        select sum(cost_usd) from anthropic_usage
        where created_at >= now() - interval '30 days'
      ), 0),
      'input_tokens', coalesce((select sum(input_tokens) from anthropic_usage), 0),
      'output_tokens', coalesce((select sum(output_tokens) from anthropic_usage), 0),
      'cache_read_tokens', coalesce((select sum(cache_read_input_tokens) from anthropic_usage), 0),
      'cache_creation_tokens', coalesce((select sum(cache_creation_input_tokens) from anthropic_usage), 0),
      'web_search_requests', coalesce((select sum(web_search_requests) from anthropic_usage), 0),
      'tracking_since', (select min(created_at) from anthropic_usage),
      'by_feature', coalesce((
        select jsonb_agg(t order by t.usd desc)
        from (
          select feature, sum(cost_usd) as usd, count(*) as calls
          from anthropic_usage group by feature
        ) t
      ), '[]'::jsonb),
      'by_model', coalesce((
        select jsonb_agg(t order by t.usd desc)
        from (
          select model, sum(cost_usd) as usd, count(*) as calls
          from anthropic_usage group by model
        ) t
      ), '[]'::jsonb),
      'daily_14d', coalesce((
        select jsonb_agg(t order by t.day)
        from (
          select (created_at at time zone 'UTC')::date as day, sum(cost_usd) as usd
          from anthropic_usage
          where created_at >= now() - interval '14 days'
          group by 1
        ) t
      ), '[]'::jsonb)
    )
  );
$$;

grant execute on function public.pirol_admin_dashboard_stats() to authenticated;
grant execute on function public.pirol_admin_dashboard_stats() to service_role;
