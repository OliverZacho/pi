-- ---------------------------------------------------------------------------
-- Brand claim facts: the DB side of lib/brand-claims.ts.
--
-- The claim engine needs, per brand: a campaign count and window, a send-day
-- count, a subject-line count, a campaign-type mix, weekday and hour
-- histograms, discount frequency/depths/mechanics, deadline behaviour, ESP and
-- three craft shares. It also needs the brand's category medians to score how
-- unusual any of that is.
--
-- Computing the medians in the app would mean pulling every brand in the
-- category into the function on every render. Computing them per request in SQL
-- would mean a percentile scan over the whole category per page. Both are wrong
-- for a page Googlebot is meant to crawl 450 times. These views push the work
-- into the DB and reduce a render to two keyed lookups.
--
-- security_invoker so the caller's RLS on captured_emails applies, mirroring
-- brand_send_stats. The public brand page reads these through the service-role
-- client (logged-out visitors and crawlers cannot see companies under RLS,
-- and they are exactly who reads the summary), so service_role is the grant
-- that matters.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Per-brand campaign aggregates.
--
-- "Campaign" means one canonical row: cross-inbox copies collapse onto their
-- canonical via duplicate_of, so a brand blasting six segments counts once.
--
-- Welcome mail is excluded. It is triggered by our own subscription, so it says
-- more about when we subscribed than about what the brand broadcasts. This
-- MUST stay in lockstep with NON_CAMPAIGN_CATEGORIES in lib/admin-types.ts —
-- if a category is added there, add it here.
--
-- Histograms are returned as jsonb maps rather than fixed-width arrays: sparse
-- is cheaper over the wire, and the app expands them to dense arrays where the
-- claim engine wants indexable positions.
-- ---------------------------------------------------------------------------
create or replace view public.brand_campaign_stats
with (security_invoker = true) as
with zones as (
  -- Send-hour claims are meaningless without a zone, and the brand page's
  -- viewer-local rendering cannot be used for prose that gets cached and
  -- indexed. The brand's primary market is the best stable proxy we have.
  --
  -- 'US' and 'CA' collapse to their eastern zones: both span several, and the
  -- eastern one is where the large majority of tracked brands operate. That is
  -- an approximation, which is why the label names a city rather than implying
  -- a nationwide clock.
  select
    c.id as company_id,
    case c.primary_market_country
      when 'DK' then 'Europe/Copenhagen'
      when 'US' then 'America/New_York'
      when 'GB' then 'Europe/London'
      when 'SE' then 'Europe/Stockholm'
      when 'FR' then 'Europe/Paris'
      when 'NO' then 'Europe/Oslo'
      when 'IT' then 'Europe/Rome'
      when 'DE' then 'Europe/Berlin'
      when 'CA' then 'America/Toronto'
      when 'NL' then 'Europe/Amsterdam'
      when 'ES' then 'Europe/Madrid'
      when 'AU' then 'Australia/Sydney'
      when 'CH' then 'Europe/Zurich'
      when 'BE' then 'Europe/Brussels'
      when 'IE' then 'Europe/Dublin'
      when 'FI' then 'Europe/Helsinki'
      when 'IS' then 'Atlantic/Reykjavik'
      when 'AE' then 'Asia/Dubai'
      when 'HK' then 'Asia/Hong_Kong'
      when 'EU' then 'Europe/Brussels'
      else 'UTC'
    end as zone,
    case c.primary_market_country
      when 'DK' then 'Copenhagen time'
      when 'US' then 'New York time'
      when 'GB' then 'London time'
      when 'SE' then 'Stockholm time'
      when 'FR' then 'Paris time'
      when 'NO' then 'Oslo time'
      when 'IT' then 'Rome time'
      when 'DE' then 'Berlin time'
      when 'CA' then 'Toronto time'
      when 'NL' then 'Amsterdam time'
      when 'ES' then 'Madrid time'
      when 'AU' then 'Sydney time'
      when 'CH' then 'Zurich time'
      when 'BE' then 'Brussels time'
      when 'IE' then 'Dublin time'
      when 'FI' then 'Helsinki time'
      when 'IS' then 'Reykjavik time'
      when 'AE' then 'Dubai time'
      when 'HK' then 'Hong Kong time'
      when 'EU' then 'Brussels time'
      else 'UTC'
    end as zone_label
  from public.companies c
),
campaigns as (
  select
    ce.company_id,
    ce.subject,
    coalesce(ce.category, 'other') as category,
    ce.discount_percent,
    ce.promo_code,
    ce.offer_ends_on,
    ce.offer_is_extension,
    ce.esp_provider,
    ce.preheader_padded,
    ce.has_dark_mode,
    ce.has_gif,
    ce.sent_at,
    (ce.sent_at at time zone z.zone) as local_sent,
    z.zone_label
  from public.captured_emails ce
  join zones z on z.company_id = ce.company_id
  where ce.company_id is not null
    and ce.duplicate_of is null
    and coalesce(ce.category, '') <> 'welcome'
    and ce.sent_at is not null
),
base as (
  select
    company_id,
    min(zone_label) as zone_label,
    count(*)::int as campaigns,
    min(sent_at) as first_send,
    max(sent_at) as last_send,
    greatest((max(local_sent)::date - min(local_sent)::date), 1)::int as span_days,
    count(distinct local_sent::date)::int as send_days,
    count(distinct lower(btrim(subject)))::int as distinct_subjects,
    count(*) filter (where discount_percent is not null and discount_percent > 0)::int
      as discount_count,
    max(discount_percent) as max_discount,
    count(*) filter (where promo_code is not null)::int as promo_code_count,
    count(*) filter (where offer_ends_on is not null)::int as deadline_count,
    count(*) filter (where offer_is_extension)::int as extension_count,
    mode() within group (order by esp_provider) as esp,
    (count(*) filter (where preheader_padded))::double precision / count(*) as padded_share,
    (count(*) filter (where has_dark_mode))::double precision / count(*) as dark_share,
    (count(*) filter (where has_gif))::double precision / count(*) as gif_share
  from campaigns
  group by company_id
),
-- The deepest advertised discount is a CEILING ("Up to 70% Off"), never a
-- sitewide depth. Carried through with its date so the claim engine can say
-- when, and always rendered as "up to".
deepest as (
  select distinct on (company_id)
    company_id,
    sent_at as max_discount_at
  from campaigns
  where discount_percent is not null and discount_percent > 0
  order by company_id, discount_percent desc, sent_at desc
),
depths as (
  select company_id, array_agg(distinct discount_percent order by discount_percent) as discount_depths
  from campaigns
  where discount_percent is not null and discount_percent > 0
  group by company_id
),
per_hour as (
  select company_id, extract(hour from local_sent)::int as bucket, count(*)::int as n
  from campaigns group by 1, 2
),
per_dow as (
  select company_id, extract(dow from local_sent)::int as bucket, count(*)::int as n
  from campaigns group by 1, 2
),
per_cat as (
  select company_id, category as bucket, count(*)::int as n
  from campaigns group by 1, 2
)
select
  base.company_id,
  base.zone_label,
  base.campaigns,
  base.first_send,
  base.last_send,
  base.span_days,
  base.send_days,
  base.distinct_subjects,
  base.discount_count,
  base.max_discount,
  deepest.max_discount_at,
  coalesce(depths.discount_depths, '{}')::numeric[] as discount_depths,
  base.promo_code_count,
  base.deadline_count,
  base.extension_count,
  base.esp,
  base.padded_share,
  base.dark_share,
  base.gif_share,
  coalesce(h.counts, '{}'::jsonb) as hour_counts,
  coalesce(d.counts, '{}'::jsonb) as weekday_counts,
  coalesce(m.counts, '{}'::jsonb) as mix
from base
left join deepest on deepest.company_id = base.company_id
left join depths on depths.company_id = base.company_id
left join (
  select company_id, jsonb_object_agg(bucket::text, n) as counts from per_hour group by 1
) h on h.company_id = base.company_id
left join (
  select company_id, jsonb_object_agg(bucket::text, n) as counts from per_dow group by 1
) d on d.company_id = base.company_id
left join (
  select company_id, jsonb_object_agg(bucket, n) as counts from per_cat group by 1
) m on m.company_id = base.company_id;

grant select on public.brand_campaign_stats to authenticated;
grant select on public.brand_campaign_stats to service_role;

-- ---------------------------------------------------------------------------
-- 2. The benchmark pool: brands whose data can legitimately set a category norm.
--
-- A brand with four campaigns over two days would compute to fourteen sends a
-- week and drag its category median upward, so the pool requires a real window.
-- The email_count floor mirrors MIN_INDEXABLE_EMAILS in lib/brand-summary.ts;
-- keep the two in lockstep.
--
-- Category is markets[1], the primary tag, matching what the brand page and the
-- claim engine treat as "the category".
-- ---------------------------------------------------------------------------
create or replace view public.brand_benchmark_pool
with (security_invoker = true) as
select
  s.company_id,
  coalesce(c.markets[1], '(none)') as category,
  s.campaigns,
  s.span_days,
  s.discount_count,
  s.max_discount,
  (s.campaigns::numeric / greatest(s.span_days, 1) * 7)::double precision as per_week,
  (s.discount_count::numeric / s.campaigns)::double precision as discount_share,
  rank() over (
    partition by coalesce(c.markets[1], '(none)')
    order by s.campaigns::numeric / greatest(s.span_days, 1) desc
  )::int as rank_per_week
from public.brand_campaign_stats s
join public.companies c on c.id = s.company_id
join public.company_email_stats es on es.company_id = c.id
where c.deleted_at is null
  and es.email_count >= 5
  and s.campaigns >= 5
  and s.span_days >= 14;

grant select on public.brand_benchmark_pool to authenticated;
grant select on public.brand_benchmark_pool to service_role;

-- ---------------------------------------------------------------------------
-- 3. Category medians, one row per category.
--
-- median_max_discount is the median of the *deepest advertised* offer among
-- brands that discount at all, so a category full of non-discounters does not
-- pull it to zero and make everyone look aggressive by comparison.
-- ---------------------------------------------------------------------------
create or replace view public.brand_category_benchmarks
with (security_invoker = true) as
select
  category,
  count(*)::int as brands,
  percentile_cont(0.5) within group (order by per_week)::double precision
    as median_per_week,
  percentile_cont(0.9) within group (order by per_week)::double precision
    as p90_per_week,
  percentile_cont(0.5) within group (order by discount_share)::double precision
    as median_discount_share,
  (
    percentile_cont(0.5) within group (
      order by case when discount_count > 0 then max_discount end
    )
  )::double precision as median_max_discount,
  ((count(*) filter (where discount_count > 0))::numeric / count(*))::double precision
    as share_that_discount
from public.brand_benchmark_pool
group by category;

grant select on public.brand_category_benchmarks to authenticated;
grant select on public.brand_category_benchmarks to service_role;
