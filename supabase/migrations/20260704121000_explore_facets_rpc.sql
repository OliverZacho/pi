-- ---------------------------------------------------------------------------
-- explore_facets: Explore filter-dropdown facets, aggregated in the DB.
--
-- Replaces the app-side pass that pulled up to 10k captured-email rows
-- (joined to companies) into the serverless function on every Explore /
-- Following facets request just to dedupe brands, markets, categories and
-- countries in JS. One small JSON blob crosses the wire instead, and the
-- facets now cover the full data set rather than an arbitrary 10k-row slice.
--
-- `restrict_ids` scopes the facets to a brand set (the /following page).
-- SECURITY INVOKER, so RLS on captured_emails/companies applies to the
-- caller exactly as the old direct query did: entitled subscribers and the
-- service role see data, everyone else gets empty facets.
-- ---------------------------------------------------------------------------
create or replace function public.explore_facets(restrict_ids uuid[] default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  with scoped as (
    select category, segment_category, detected_country, company_id
    from public.captured_emails
    where company_id is not null
      and (restrict_ids is null or company_id = any(restrict_ids))
  ),
  brand_rows as (
    select c.id, c.name, c.markets, c.is_curated
    from public.companies c
    where c.id in (select company_id from scoped)
  )
  select jsonb_build_object(
    'brands', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'name', b.name,
          'markets', coalesce((
            select jsonb_agg(m)
            from unnest(coalesce(b.markets, '{}')) as m
            where length(m) > 0
          ), '[]'::jsonb),
          'isCurated', coalesce(b.is_curated, false)
        )
        order by lower(b.name)
      )
      from brand_rows b
    ), '[]'::jsonb),
    'markets', coalesce((
      select jsonb_agg(distinct m order by m)
      from (
        select segment_category as m
        from scoped
        where segment_category is not null and length(segment_category) > 0
        union
        select m
        from brand_rows b, unnest(coalesce(b.markets, '{}')) as m
        where length(m) > 0
      ) markets_union
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(distinct category order by category)
      from scoped
      where category is not null and length(category) > 0
    ), '[]'::jsonb),
    'countries', coalesce((
      select jsonb_agg(distinct upper(detected_country) order by upper(detected_country))
      from scoped
      where detected_country ~ '^[A-Za-z]{2}$'
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.explore_facets(uuid[]) from public;
revoke all on function public.explore_facets(uuid[]) from anon;
grant execute on function public.explore_facets(uuid[]) to authenticated;
grant execute on function public.explore_facets(uuid[]) to service_role;
