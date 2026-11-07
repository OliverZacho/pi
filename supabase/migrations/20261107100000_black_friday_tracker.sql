-- Black Friday Email Tracker 2026 (public page at /black-friday).
--
-- One read-only function returns every number the page draws, computed live
-- from captured_emails over Oct 1 .. Dec 2 (Copenhagen days). Nothing is
-- written to captured_emails. Computing it takes seconds (wide rows), so an
-- hourly pg_cron job stores the result in black_friday_snapshots, one row per
-- Copenhagen day: the page reads the latest row, and the earlier rows are the
-- frozen day-by-day numbers for social posts and the final report.
--
-- A "Black Friday email" is one whose subject or preview text names the
-- event (English, Danish, Swedish variants; Cyber Monday counts too), minus
-- welcome emails and minus opt-out messages (Green Friday, Giving Tuesday,
-- "no Black Friday"), which are counted separately. Keep the keyword list in
-- lockstep with the methodology copy on the page (lib/black-friday.ts).
--
-- Anything that names a brand next to a discount (deepest list, gallery
-- badges) uses stated_pct: the extracted percentage only when the subject or
-- preview text states that same number. Aggregates use every extraction.
--
-- Service-role only: the page calls it server-side, so anon gets nothing.

create or replace function public.black_friday_tracker()
returns jsonb
language sql
stable
security definer
set search_path = public
set statement_timeout = '120s'
as $$
with params as (
  select date '2026-11-27' as bf_day,
         date '2026-10-01' as start_day,
         date '2026-10-31' as base_end,
         least((now() at time zone 'Europe/Copenhagen')::date, date '2026-12-02') as end_day
),
raw as (
  select ce.id,
         ce.company_id,
         ce.subject,
         ce.discount_percent,
         ce.offer_ends_on,
         ce.offer_is_extension,
         coalesce(ce.has_gif, false) as has_gif,
         ce.promo_code,
         coalesce(cardinality(ce.image_urls), 0) > 0 as has_image,
         (coalesce(ce.sent_at, ce.created_at) at time zone 'Europe/Copenhagen') as ts,
         -- Preview text keeps HTML entities (udl&#248;ber); decode the Nordic ones.
         lower(replace(replace(replace(replace(
           coalesce(ce.subject, '') || ' ' || coalesce(ce.preheader, ''),
           '&#248;', 'ø'), '&#229;', 'å'), '&#230;', 'æ'), '&amp;', '&')) as s
  from captured_emails ce
  join companies c on c.id = ce.company_id and c.deleted_at is null
  where ce.duplicate_of is null
    and ce.created_at >= timestamptz '2026-09-29'
    and ce.created_at <  timestamptz '2026-12-04'
    and coalesce(ce.category, '') <> 'welcome'
),
tagged as (
  select r.*,
         r.ts::date as d,
         r.s ~ '(green[ -]?friday|giving[ -]?tuesday|white[ -]?friday|buy[ -]?nothing[ -]?day|grøn[ -]?fredag|ingen[ -]?black[ -]?friday|no[ -]?black[ -]?friday|not doing black[ -]?friday)' as optout,
         r.s ~ 'cyber[ -]?(monday|week|weekend)' as cyber,
         r.s ~ '(black[ -]?(friday|week|weekend|november|month)|sort[ -]?fredag|cyber[ -]?(monday|week|weekend))' as kw,
         case when r.discount_percent > 0
                   and r.s ~ ('(^|[^0-9])' || round(r.discount_percent)::int::text || ' ?%')
              then r.discount_percent end as stated_pct
  from raw r
),
g as materialized (
  select t.*, (t.kw and not t.optout) as bf
  from tagged t, params p
  where t.d between p.start_day and p.end_day
),
bfe as materialized (select * from g where bf),
brand as materialized (
  select c.id,
         c.name,
         c.slug,
         c.domain,
         c.logo_storage_path,
         c.logo_source,
         c.primary_market_country as country,
         (select bp.category from brand_benchmark_pool bp where bp.company_id = c.id limit 1) as category
  from companies c
  where c.id in (select distinct company_id from g)
),
base as (
  select count(*)::numeric as emails,
         count(distinct company_id) as brands,
         avg(has_gif::int) as gif,
         avg((offer_ends_on is not null)::int) as deadline
  from g, params p
  where g.d <= p.base_end and not g.bf
),
last7 as (
  select count(*)::numeric as emails
  from g, params p
  where g.d > p.end_day - 7
),
headline as (
  select jsonb_build_object(
    'brands_tracked', (select brands from base),
    'brands_live', (select count(distinct company_id) from bfe),
    'bf_emails', (select count(*) from bfe),
    'median_discount', (select percentile_cont(0.5) within group (order by discount_percent)
                          from bfe where discount_percent > 0),
    'brands_extended', (select count(distinct company_id) from bfe
                          where offer_is_extension or s ~ '(extended|forlæng|förläng|forleng|verlänger)'),
    'deadline_share', (select avg((offer_ends_on is not null)::int) from bfe),
    'volume_lift', (select round(((select emails from last7) / 7) / nullif((select emails from base) / 31, 0), 2)),
    'cyber_share', (select avg(cyber::int) from bfe),
    'new_brands_7d', (select count(*) from (select company_id from bfe group by company_id
                        having min(d) > (select end_day from params) - 7) n)
  ) as j
),
daily as (
  select jsonb_agg(jsonb_build_object('d', day, 'bf', coalesce(x.bf, 0), 'all', coalesce(x.total, 0)) order by day) as j
  from params p
  cross join generate_series(p.start_day, p.end_day, interval '1 day') as gs(day0)
  cross join lateral (select gs.day0::date as day) dd
  left join (
    select d, count(*) filter (where bf) as bf, count(*) as total from g group by d
  ) x on x.d = dd.day
),
firsts as (
  select company_id, min(d) as first_day from bfe group by company_id
),
-- Weeks before Black Friday of each brand's first Black Friday email:
-- 1..8 (8 = eight or more), 0 = on the day, -1 = after it.
lead as (
  select jsonb_build_object(
    'buckets', (
      select jsonb_agg(jsonb_build_object('w', w, 'n', n) order by w)
      from (
        select case when p.bf_day - f.first_day < 0 then -1
                    when p.bf_day - f.first_day = 0 then 0
                    else least(ceil((p.bf_day - f.first_day) / 7.0), 8)::int end as w,
               count(*) as n
        from firsts f, params p group by 1
      ) b
    )
  ) as j
),
disc as (
  select jsonb_build_object(
    'buckets', (
      select jsonb_agg(jsonb_build_object('k', k, 'n', n) order by k)
      from (
        select case when discount_percent < 20 then 0
                    when discount_percent < 30 then 1
                    when discount_percent < 40 then 2
                    when discount_percent < 50 then 3
                    when discount_percent < 60 then 4
                    when discount_percent < 70 then 5
                    else 6 end as k,
               count(*) as n
        from bfe where discount_percent > 0 group by 1
      ) b
    ),
    'no_discount', (select count(*) from bfe where coalesce(discount_percent, 0) = 0),
    'by_category', (
      select jsonb_agg(jsonb_build_object('label', category, 'median', med, 'brands', nb) order by med desc)
      from (
        select b.category,
               percentile_cont(0.5) within group (order by e.discount_percent) as med,
               count(distinct e.company_id) as nb
        from bfe e join brand b on b.id = e.company_id
        where e.discount_percent > 0 and b.category is not null
        group by b.category
        having count(distinct e.company_id) >= 3
      ) c
    ),
    'by_country', (
      select jsonb_agg(jsonb_build_object('label', country, 'median', med, 'brands', nb) order by nb desc)
      from (
        select b.country,
               percentile_cont(0.5) within group (order by e.discount_percent) as med,
               count(distinct e.company_id) as nb
        from bfe e join brand b on b.id = e.company_id
        where e.discount_percent > 0 and b.country is not null
        group by b.country
        having count(distinct e.company_id) >= 3
        order by nb desc
        limit 6
      ) c
    ),
    'deepest', (
      select jsonb_agg(jsonb_build_object('brand', company_id, 'pct', stated_pct, 'subject', subject, 'd', d)
                       order by stated_pct desc, d)
      from (
        select distinct on (company_id) company_id, stated_pct, subject, d
        from bfe where stated_pct is not null
        order by company_id, stated_pct desc, d
      ) x
      where x.company_id in (
        select company_id from bfe where stated_pct is not null
        group by company_id order by max(stated_pct) desc, min(d) limit 10
      )
    )
  ) as j
),
windows as (
  select jsonb_agg(jsonb_build_object('brand', company_id, 'start', start_day, 'first_end', first_end,
                                      'end', last_end, 'extended', extended)
                   order by start_day, last_end) as j
  from (
    select company_id,
           min(d) as start_day,
           (array_agg(offer_ends_on order by d) filter (where offer_ends_on is not null))[1] as first_end,
           max(offer_ends_on) as last_end,
           bool_or(coalesce(offer_is_extension, false) or s ~ '(extended|forlæng|förläng|forleng|verlänger)') as extended
    from bfe
    group by company_id
    having max(offer_ends_on) is not null
    order by bool_or(coalesce(offer_is_extension, false)) desc, count(*) desc
    limit 14
  ) w
),
-- Share of each brand's emails since its first Black Friday email that are
-- about Black Friday: a raw count would rank daily senders above brands that
-- went all in.
loudest as (
  select jsonb_agg(jsonb_build_object('brand', company_id, 'n', n, 'total', total)
                   order by n::numeric / total desc, n desc) as j
  from (
    select company_id, n, total
    from (
      select f.company_id,
             (select count(*) from bfe e where e.company_id = f.company_id) as n,
             (select count(*) from g x where x.company_id = f.company_id and x.d >= f.first_day) as total
      from firsts f
    ) c
    where n >= 3
    order by n::numeric / total desc, n desc
    limit 10
  ) l
),
peak as (
  select jsonb_build_object('d', d, 'n', n) as j
  from (select d, count(*) as n from bfe group by d order by n desc, d limit 1) p
),
-- Campaign stage from the subject + preview wording, first match wins.
staged as (
  select d,
         case
           when offer_is_extension or s ~ '(extended|forlæng|förläng|forleng|verlänger)' then 'extended'
           when s ~ '(last chance|sidste chance|sista chansen|letzte chance|last day|sidste dag|final hours|final day|ends tonight|ends today|ends at midnight|ending soon|slutter i dag|udløber|sidste timer|hours left|going fast|selling fast|almost gone|remaining)' then 'last_chance'
           when s ~ '(\mearly|tidlig|\mvip\M|før alle andre|before everyone|before anyone|first in line|sneak peek|preview|pre-?sale|first access|exclusive access|eksklusiv adgang|medlemspris|förtur|warm[ -]?up)' then 'early'
           when s ~ '(is here|is live|\mlive\M|starts? now|starter nu|nu starter|starts today|starter i dag|now on\M|er i gang|has started|har startet|er startet|er skudt i gang|is on\M|er her|lige nu)' then 'live'
           when s ~ '(coming|soon|save the date|snart|countdown|get ready|gør dig klar|kommer|days to go|is near|nærmer sig|starts tomorrow|starter i morgen|starter [0-9])' then 'teaser'
           when s ~ '[0-9] ?%' then 'live'
           else 'other'
         end as stage
  from bfe
),
-- Every started brand, grouped by the longest name it has used for the
-- event in its own subject or preview text: a month, a week, or the day
-- (weekend wording counts as the day). Read from wording only, so it never
-- claims whether a brand's sale is live.
board as (
  select jsonb_agg(jsonb_build_object('brand', company_id, 'group', grp, 'since', since)
                   order by grp, since, company_id) as j
  from (
    select company_id,
           min(d) as since,
           case when bool_or(s ~ '(black[ -]?(november|month)|black[ -]?måned)') then 'month'
                when bool_or(s ~ '(black[ -]?week\M|cyber[ -]?week\M)') then 'week'
                else 'day' end as grp
    from bfe
    group by company_id
  ) b
),
stages as (
  select jsonb_agg(jsonb_build_object('wk', wk, 'stage', stage, 'n', n) order by wk, stage) as j
  from (select date_trunc('week', d)::date as wk, stage, count(*) as n from staged group by 1, 2) x
),
subj as (
  select jsonb_build_object(
    'avg_length', (select round(avg(char_length(subject))) from bfe where subject is not null),
    'emoji_share', (select avg((subject ~ '[\U0001F300-\U0001FAFF☀-➿]')::int) from bfe),
    'caps_share', (select avg((subject ~ '\m[A-ZÆØÅÄÖÜ]{4,}\M')::int) from bfe),
    'early_access_share', (select avg((s ~ '(early access|tidlig adgang|\mvip\M|før alle andre|before anyone|before everyone|first access|förtur)')::int) from bfe),
    'free_shipping_share', (select avg((s ~ '(free shipping|free delivery|fri fragt|fri frakt|gratis levering|fri levering)')::int) from bfe),
    'promo_code_share', (select avg((promo_code is not null)::int) from bfe),
    'examples', (
      select jsonb_agg(jsonb_build_object('brand', company_id, 'subject', subject, 'd', d) order by d desc, ts desc)
      from (
        select distinct on (company_id) company_id, subject, d, ts
        from bfe where subject is not null and char_length(subject) between 6 and 120
        order by company_id, ts desc
      ) x
      where x.company_id in (
        select company_id from bfe group by company_id order by max(ts) desc limit 20
      )
    )
  ) as j
),
design as (
  select jsonb_build_object(
    'gif_bf', (select avg(has_gif::int) from bfe),
    'gif_base', (select gif from base),
    'deadline_bf', (select avg((offer_ends_on is not null)::int) from bfe),
    'deadline_base', (select deadline from base)
  ) as j
),
optouts as (
  select jsonb_agg(jsonb_build_object('brand', company_id, 'subject', subject, 'd', d) order by d desc) as j
  from (
    select distinct on (company_id) company_id, subject, d
    from g where optout
    order by company_id, d desc
  ) o
),
gallery as (
  select jsonb_agg(jsonb_build_object('id', id, 'brand', company_id, 'subject', subject, 'd', d, 'pct', stated_pct)
                   order by ts desc) as j
  from (
    select distinct on (company_id) id, company_id, subject, d, ts, stated_pct
    from bfe where has_image
    order by company_id, ts desc
  ) x
  where x.company_id in (
    select company_id from bfe where has_image group by company_id order by max(ts) desc limit 16
  )
),
used as (
  select (x ->> 'brand')::uuid as id
  from (
    select jsonb_array_elements(coalesce((select j from board), '[]')) as x
    union all select jsonb_array_elements(coalesce((select j -> 'deepest' from disc), '[]'))
    union all select jsonb_array_elements(coalesce((select j from windows), '[]'))
    union all select jsonb_array_elements(coalesce((select j from loudest), '[]'))
    union all select jsonb_array_elements(coalesce((select j -> 'examples' from subj), '[]'))
    union all select jsonb_array_elements(coalesce((select j from optouts), '[]'))
    union all select jsonb_array_elements(coalesce((select j from gallery), '[]'))
  ) u
),
brands_json as (
  select jsonb_object_agg(b.id, jsonb_build_object(
           'name', b.name, 'slug', b.slug, 'domain', b.domain,
           'logo_path', b.logo_storage_path, 'logo_source', b.logo_source,
           'country', b.country)) as j
  from brand b
  where b.id in (select id from used)
)
select jsonb_build_object(
  'generated_at', now(),
  'through', (select end_day from params),
  'headline', (select j from headline),
  'daily', coalesce((select j from daily), '[]'),
  'lead', (select j from lead),
  'discounts', (select j from disc),
  'windows', coalesce((select j from windows), '[]'),
  'loudest', coalesce((select j from loudest), '[]'),
  'peak', (select j from peak),
  'stages', coalesce((select j from stages), '[]'),
  'board', coalesce((select j from board), '[]'),
  'subjects', (select j from subj),
  'design', (select j from design),
  'optouts', coalesce((select j from optouts), '[]'),
  'gallery', coalesce((select j from gallery), '[]'),
  'brands', coalesce((select j from brands_json), '{}')
);
$$;

revoke all on function public.black_friday_tracker() from public, anon, authenticated;
grant execute on function public.black_friday_tracker() to service_role;

create table if not exists public.black_friday_snapshots (
  day date primary key,
  data jsonb not null,
  computed_at timestamptz not null default now()
);
alter table public.black_friday_snapshots enable row level security;
revoke all on public.black_friday_snapshots from anon, authenticated;

create or replace function public.refresh_black_friday_snapshot()
returns void
language sql
security definer
set search_path = public
as $$
  insert into black_friday_snapshots (day, data, computed_at)
  select (now() at time zone 'Europe/Copenhagen')::date, black_friday_tracker(), now()
  where (now() at time zone 'Europe/Copenhagen')::date <= date '2026-12-03'
  on conflict (day) do update set data = excluded.data, computed_at = excluded.computed_at;
$$;

revoke all on function public.refresh_black_friday_snapshot() from public, anon, authenticated;

do $$
declare
  existing_jobid bigint;
begin
  select jobid into existing_jobid from cron.job where jobname = 'pirol-black-friday-snapshot';
  if existing_jobid is not null then
    perform cron.unschedule(existing_jobid);
  end if;
  perform cron.schedule('pirol-black-friday-snapshot', '5 * * * *',
    'select public.refresh_black_friday_snapshot()');
end
$$;

select public.refresh_black_friday_snapshot();
