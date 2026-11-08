-- Stored smart-collection matches.
--
-- Smart collections used to re-run their rule as one archive-wide search on
-- every page view. Even with the search_text trigram index that recheck
-- reads the full text of every candidate email (0.5 to 5s per rule at 20k
-- emails, growing with the archive) and under RLS it can't use the index at
-- all, which 500'd collection pages past the 8s statement timeout.
--
-- Instead each smart collection keeps its matches in `collection_matches`,
-- built once by a background worker that walks the archive in fixed-size
-- chunks in ingest order (created_at, id). Every chunk is a bounded amount of
-- work whatever the archive size, so a build never times out; it just takes
-- longer, and the UI shows progress and an estimate. After the build the same
-- cursor keeps advancing over newly ingested emails, so a view only ever
-- checks emails it hasn't seen before.
--
-- The cache holds matches for the rule's CONDITIONS only. Scope (past /
-- future cutoff) and the time window are applied at read time on the stored
-- received_at, so a rolling "last 30 days" window stays correct as time
-- passes and editing only the window needs no rebuild.
--
-- Build state lives in its own table, not on `collections`, because every
-- update to a collections row bumps updated_at, which reorders the sidebar.

create table if not exists public.collection_matches (
  collection_id uuid not null references public.collections (id) on delete cascade,
  email_id uuid not null references public.captured_emails (id) on delete cascade,
  received_at timestamptz not null,
  email_created_at timestamptz not null,
  primary key (collection_id, email_id)
);

create index if not exists collection_matches_recent_idx
  on public.collection_matches (collection_id, received_at desc);
create index if not exists collection_matches_created_idx
  on public.collection_matches (collection_id, email_created_at);
-- Serves the cascade when an email is deleted.
create index if not exists collection_matches_email_idx
  on public.collection_matches (email_id);

create table if not exists public.collection_match_builds (
  collection_id uuid primary key references public.collections (id) on delete cascade,
  -- Which rule conditions the stored matches were built for. A mismatch
  -- with the collection's current rules means the matches are stale.
  match_key text not null,
  status text not null check (status in ('building', 'ready')),
  -- Every email at or before (cursor_at, cursor_id) in ingest order has
  -- been checked against the rule.
  cursor_at timestamptz not null default '-infinity',
  cursor_id uuid not null default '00000000-0000-0000-0000-000000000000',
  -- Progress of the current build, for the progress bar and estimate.
  scanned integer not null default 0,
  total integer not null default 0,
  started_at timestamptz not null default now(),
  ready_at timestamptz,
  updated_at timestamptz not null default now(),
  -- Last time anyone opened the collection's page. Collections nobody has
  -- opened in 30 days go dormant: no background build work (see
  -- collection_match_builds_due) until the next open catches them up.
  last_opened_at timestamptz not null default now()
);

create index if not exists collection_match_builds_building_idx
  on public.collection_match_builds (started_at)
  where status = 'building';

-- Keyset walk of the archive in ingest order.
create index if not exists captured_emails_created_id_idx
  on public.captured_emails (created_at, id);

-- Matches are written and read by server code on the service role only,
-- after the app has checked the viewer's access to the collection.
alter table public.collection_matches enable row level security;
revoke all on public.collection_matches from anon, authenticated;

-- Build status is readable by anyone who can read the collection (RLS on
-- `collections` applies inside the subquery), so the sidebar can show
-- which collections are still building from the viewer's own session.
alter table public.collection_match_builds enable row level security;
revoke all on public.collection_match_builds from anon, authenticated;
grant select on public.collection_match_builds to authenticated;
drop policy if exists collection_match_builds_read on public.collection_match_builds;
create policy collection_match_builds_read on public.collection_match_builds
  for select to authenticated
  using (exists (select 1 from public.collections c where c.id = collection_id));

-- One compiled filter against one email. Filters are compiled in
-- lib/collections-db.ts (compileRules) and passed in as JSON, so the
-- brand-name and market lookups stay in one place:
--   {type: category_in, values}, {type: country_in, values},
--   {type: in_company, ids}, {type: discount, op, value},
--   {type: search, pattern, brandIds}
-- `pattern` is the LIKE-escaped fragment from lib/search-term.ts.
create or replace function public.collection_filter_matches(
  f jsonb,
  p_search_text text,
  p_category text,
  p_country text,
  p_company_id uuid,
  p_discount numeric
) returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(
    case f ->> 'type'
      when 'category_in' then
        p_category in (select jsonb_array_elements_text(f -> 'values'))
      when 'country_in' then
        p_country in (select jsonb_array_elements_text(f -> 'values'))
      when 'in_company' then
        p_company_id::text in (select jsonb_array_elements_text(f -> 'ids'))
      when 'discount' then
        case f ->> 'op'
          when 'gte' then p_discount >= (f ->> 'value')::numeric
          when 'lte' then p_discount <= (f ->> 'value')::numeric
          else p_discount = (f ->> 'value')::numeric
        end
      when 'search' then
        p_search_text ilike ('%' || (f ->> 'pattern') || '%')
        or p_company_id::text in (
          select jsonb_array_elements_text(coalesce(f -> 'brandIds', '[]'::jsonb))
        )
      else false
    end,
    false
  )
$fn$;

create or replace function public.collection_rule_matches(
  p_combinator text,
  p_filters jsonb,
  p_search_text text,
  p_category text,
  p_country text,
  p_company_id uuid,
  p_discount numeric
) returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_combinator = 'OR' then coalesce(bool_or(m), false)
    else coalesce(bool_and(m), false)
  end
  from (
    select public.collection_filter_matches(
      f, p_search_text, p_category, p_country, p_company_id, p_discount
    ) as m
    from jsonb_array_elements(p_filters) as f
  ) s
$fn$;

-- (Re)start a build for new rule conditions, or clear everything when
-- p_match_key is null (rules removed). Waits for any in-flight chunk on the
-- old key so its inserts can't land after the clear.
create or replace function public.reset_collection_matches(
  p_collection_id uuid,
  p_match_key text
) returns void
language plpgsql
set search_path = ''
as $fn$
declare
  v_total integer;
begin
  perform 1
  from public.collection_match_builds
  where collection_id = p_collection_id
  for update;

  delete from public.collection_matches where collection_id = p_collection_id;

  if p_match_key is null then
    delete from public.collection_match_builds where collection_id = p_collection_id;
    return;
  end if;

  -- Total for the progress bar. An exact count while that's cheap (an
  -- index-only scan, ~100ms at a million rows); past that the planner's
  -- estimate, which is O(1) and close enough for a progress bar.
  select greatest(c.reltuples, 0)::integer
  into v_total
  from pg_catalog.pg_class c
  where c.oid = 'public.captured_emails'::regclass;
  if v_total < 2000000 then
    select count(*)::integer into v_total from public.captured_emails;
  end if;

  insert into public.collection_match_builds as b (
    collection_id, match_key, status, cursor_at, cursor_id,
    scanned, total, started_at, ready_at, updated_at
  ) values (
    p_collection_id, p_match_key, 'building', '-infinity',
    '00000000-0000-0000-0000-000000000000', 0, v_total, now(), null, now()
  )
  on conflict (collection_id) do update set
    match_key = excluded.match_key,
    status = 'building',
    cursor_at = '-infinity',
    cursor_id = '00000000-0000-0000-0000-000000000000',
    scanned = 0,
    total = excluded.total,
    started_at = now(),
    ready_at = null,
    updated_at = now();
end
$fn$;

-- Check the next chunk of emails (in ingest order) against the rule, store
-- the matches and advance the cursor. One call is bounded work: at most
-- p_limit emails, each read once. Returns
--   outcome: ok | busy (another worker holds this build) | stale (rules
--            changed; caller should reset) | missing (no build row)
--   status:  building | ready (caught up with the archive)
-- Emails from the last 30 seconds are left for the next call so a row
-- committed late with an earlier created_at can't be skipped past.
create or replace function public.advance_collection_matches(
  p_collection_id uuid,
  p_match_key text,
  p_combinator text,
  p_filters jsonb,
  p_limit integer default 1000
) returns table (outcome text, status text, scanned integer, matched integer)
language plpgsql
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_build public.collection_match_builds%rowtype;
  v_horizon timestamptz := now() - interval '30 seconds';
  v_count integer;
  v_last_at timestamptz;
  v_last_id uuid;
  v_matched integer := 0;
  v_status text;
begin
  select * into v_build
  from public.collection_match_builds b
  where b.collection_id = p_collection_id
  for update skip locked;

  if not found then
    if exists (
      select 1 from public.collection_match_builds b
      where b.collection_id = p_collection_id
    ) then
      return query select 'busy'::text, null::text, 0, 0;
    else
      return query select 'missing'::text, null::text, 0, 0;
    end if;
    return;
  end if;

  if v_build.match_key is distinct from p_match_key then
    return query select 'stale'::text, v_build.status, 0, 0;
    return;
  end if;

  select count(*)::integer, max(c.created_at)
  into v_count, v_last_at
  from (
    select e.created_at, e.id
    from public.captured_emails e
    where (e.created_at, e.id) > (v_build.cursor_at, v_build.cursor_id)
      and e.created_at <= v_horizon
    order by e.created_at, e.id
    limit p_limit
  ) c;

  if v_count > 0 then
    select c.id into v_last_id
    from (
      select e.created_at, e.id
      from public.captured_emails e
      where (e.created_at, e.id) > (v_build.cursor_at, v_build.cursor_id)
        and e.created_at <= v_horizon
      order by e.created_at, e.id
      limit p_limit
    ) c
    order by c.created_at desc, c.id desc
    limit 1;

    -- An empty filter list matches nothing; skip the per-row work.
    if jsonb_array_length(p_filters) > 0 then
      insert into public.collection_matches (
        collection_id, email_id, received_at, email_created_at
      )
      select p_collection_id, e.id, e.received_at, e.created_at
      from public.captured_emails e
      where e.created_at >= v_build.cursor_at
        and e.created_at <= v_last_at
        and (e.created_at, e.id) > (v_build.cursor_at, v_build.cursor_id)
        and (e.created_at, e.id) <= (v_last_at, v_last_id)
        and public.collection_rule_matches(
          p_combinator, p_filters, e.search_text, e.category,
          e.detected_country, e.company_id, e.discount_percent
        )
      on conflict do nothing;
      get diagnostics v_matched = row_count;
    end if;
  end if;

  v_status := case when v_count < p_limit then 'ready' else 'building' end;

  update public.collection_match_builds b set
    cursor_at = coalesce(v_last_at, b.cursor_at),
    cursor_id = coalesce(v_last_id, b.cursor_id),
    status = v_status,
    -- A ready collection that fell far behind (nobody opened it while
    -- thousands of emails arrived) becomes a fresh, measurable build.
    scanned = case
      when b.status = 'ready' and v_status = 'building' then v_count
      else b.scanned + v_count
    end,
    total = case
      when b.status = 'ready' and v_status = 'building' then (
        select count(*)::integer
        from public.captured_emails e
        where e.created_at > b.cursor_at
      )
      else b.total
    end,
    started_at = case
      when b.status = 'ready' and v_status = 'building' then now()
      else b.started_at
    end,
    ready_at = case
      when v_status = 'ready' and b.status = 'building' then now()
      else b.ready_at
    end,
    updated_at = now()
  where b.collection_id = p_collection_id;

  return query select 'ok'::text, v_status, v_count, v_matched;
end
$fn$;

-- Dormancy. A smart collection nobody has opened in this long gets no
-- background work: the worker doesn't build or continue it. The next open
-- catches it up (the page shows progress meanwhile). Collections with
-- new-match alert emails on never go dormant; the alerts are their use.
-- Keep in sync with COLLECTION_DORMANT_AFTER_DAYS in lib/collections-db.ts.
create or replace function public.collection_match_dormant_before()
returns timestamptz
language sql
stable
set search_path = ''
as $fn$
  select now() - interval '30 days'
$fn$;

-- Running builds the worker should advance: opened recently, or alerting.
create or replace function public.collection_match_builds_due(p_limit integer default 50)
returns table (collection_id uuid)
language sql
stable
set search_path = ''
as $fn$
  select b.collection_id
  from public.collection_match_builds b
  join public.collections c on c.id = b.collection_id
  where b.status = 'building'
    and (
      b.last_opened_at >= public.collection_match_dormant_before()
      or c.notify_new_matches
    )
  order by b.started_at
  limit p_limit
$fn$;

-- Smart collections whose rules have no build yet (created before this
-- cache existed, or whose first build was never started). The worker
-- starts these so active collections are built before anyone opens them.
-- Dormant ones wait for their next open.
create or replace function public.collections_missing_match_build(p_limit integer default 20)
returns table (id uuid, rules jsonb)
language sql
stable
set search_path = ''
as $fn$
  select c.id, c.rules
  from public.collections c
  where c.rules is not null
    and jsonb_array_length(coalesce(c.rules -> 'conditions', '[]'::jsonb)) > 0
    and (
      greatest(c.created_at, c.last_viewed_at) >= public.collection_match_dormant_before()
      or c.notify_new_matches
    )
    and not exists (
      select 1 from public.collection_match_builds b where b.collection_id = c.id
    )
  order by c.updated_at desc
  limit p_limit
$fn$;

revoke all on function public.collection_filter_matches(jsonb, text, text, text, uuid, numeric) from public, anon, authenticated;
revoke all on function public.collection_rule_matches(text, jsonb, text, text, text, uuid, numeric) from public, anon, authenticated;
revoke all on function public.reset_collection_matches(uuid, text) from public, anon, authenticated;
revoke all on function public.advance_collection_matches(uuid, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.collections_missing_match_build(integer) from public, anon, authenticated;
revoke all on function public.collection_match_dormant_before() from public, anon, authenticated;
revoke all on function public.collection_match_builds_due(integer) from public, anon, authenticated;
grant execute on function public.collection_match_dormant_before() to service_role;
grant execute on function public.collection_match_builds_due(integer) to service_role;
grant execute on function public.collection_filter_matches(jsonb, text, text, text, uuid, numeric) to service_role;
grant execute on function public.collection_rule_matches(text, jsonb, text, text, text, uuid, numeric) to service_role;
grant execute on function public.reset_collection_matches(uuid, text) to service_role;
grant execute on function public.advance_collection_matches(uuid, text, text, jsonb, integer) to service_role;
grant execute on function public.collections_missing_match_build(integer) to service_role;

-- Drive the build worker every 30 seconds, same transport as the ingest
-- processor (pg_net POST with the shared internal secret). The worker sits
-- next to the processor route, so its URL is derived from the processor's.
-- Only fires when something is waiting, so an idle archive costs nothing.
select cron.unschedule('collection-match-builds')
where exists (select 1 from cron.job where jobname = 'collection-match-builds');

select cron.schedule(
  'collection-match-builds',
  '30 seconds',
  $cron$
    select net.http_post(
      url := replace(
        (select decrypted_secret from vault.decrypted_secrets where name = 'pirol_processor_url'),
        '/process-events',
        '/build-collection-matches'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'pirol_processor_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    )
    where exists (select 1 from public.collection_match_builds_due(1))
    or exists (select 1 from public.collections_missing_match_build(1));
  $cron$
);
