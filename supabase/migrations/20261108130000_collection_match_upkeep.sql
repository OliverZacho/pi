-- Smart collection matches: background upkeep, rechecks after edits, exact
-- totals.
--
-- 1. Rechecks. A stored match is decided when the build's cursor passes the
--    email. Edits after that (a brand's markets or name, an email assigned
--    to a brand later, a re-classification or backfill) used to go unseen.
--    Triggers now queue the edited email or brand in
--    collection_match_rechecks, and advance_collection_matches re-evaluates
--    those emails (only the ones behind its cursor) before moving on. Each
--    build tracks how far through the queue it is (recheck_through), the
--    same way it tracks the archive with its cursor.
--
-- 2. Upkeep. The worker now also keeps ACTIVE collections current: every 5
--    minutes at most, a built collection that is behind (new emails or
--    queued rechecks) gets advanced. When that adds matches for new emails
--    it sets has_new_matches (the sidebar dot), which replaces the per-email
--    check that ran at ingest. Opening a collection then rarely has
--    anything left to check.
--
-- 3. Catch-ups are started explicitly by the page (start_collection_match_
--    catch_up) when the backlog is too big to check inline, instead of
--    advance flipping any ready collection that fell behind to "building".
--    Background upkeep therefore never hides an active collection behind
--    the progress panel.
--
-- 4. Long dormancy. Nightly maintenance drops the stored matches of
--    collections nobody has opened in 90 days (and without alert emails).
--    They rebuild on their next open. This bounds the recheck queue (it's
--    purged up to the slowest remaining build) and frees their storage.
--
-- 5. Exact totals for the collection page and cards
--    (collection_match_totals), deduplicated like the email grid.
--
-- 6. Drops captured_emails_created_at_idx: captured_emails_created_id_idx
--    (created_at, id) serves every query it did, scanned backwards.

-- ---------- Recheck queue ----------

create table if not exists public.collection_match_rechecks (
  id bigserial primary key,
  email_id uuid,
  company_id uuid,
  queued_at timestamptz not null default now(),
  check (num_nonnulls(email_id, company_id) = 1)
);

alter table public.collection_match_rechecks enable row level security;
revoke all on public.collection_match_rechecks from anon, authenticated;

alter table public.collection_match_builds
  add column if not exists recheck_through bigint not null default 0;

-- Existing builds have seen every edit so far (there is no queue history).
update public.collection_match_builds set recheck_through = 0;

-- Security definer: the queue is service-role only, and an edit made by
-- any role must still be able to enqueue.
create or replace function public.queue_email_match_recheck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.collection_match_rechecks (email_id) values (new.id);
  return null;
end
$fn$;

create or replace function public.queue_company_match_recheck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.collection_match_rechecks (company_id) values (new.id);
  return null;
end
$fn$;

-- Every column a rule (or the stored received_at) depends on.
drop trigger if exists captured_emails_queue_match_recheck on public.captured_emails;
create trigger captured_emails_queue_match_recheck
  after update of company_id, category, detected_country, discount_percent, search_text, received_at
  on public.captured_emails
  for each row
  when (
    old.company_id is distinct from new.company_id
    or old.category is distinct from new.category
    or old.detected_country is distinct from new.detected_country
    or old.discount_percent is distinct from new.discount_percent
    or old.search_text is distinct from new.search_text
    or old.received_at is distinct from new.received_at
  )
  execute function public.queue_email_match_recheck();

-- Market rules and brand-name search matches resolve to brands.
drop trigger if exists companies_queue_match_recheck on public.companies;
create trigger companies_queue_match_recheck
  after update of markets, name
  on public.companies
  for each row
  when (old.markets is distinct from new.markets or old.name is distinct from new.name)
  execute function public.queue_company_match_recheck();

revoke all on function public.queue_email_match_recheck() from public, anon, authenticated;
revoke all on function public.queue_company_match_recheck() from public, anon, authenticated;

-- ---------- Reset: a new build starts past every queued recheck ----------

create or replace function public.reset_collection_matches(
  p_collection_id uuid,
  p_match_key text
) returns void
language plpgsql
set search_path = ''
as $fn$
declare
  v_total integer;
  v_recheck bigint;
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

  -- The build reads every email fresh, so earlier queued edits are moot.
  select coalesce(max(r.id), 0) into v_recheck from public.collection_match_rechecks r;

  insert into public.collection_match_builds as b (
    collection_id, match_key, status, cursor_at, cursor_id,
    scanned, total, started_at, ready_at, updated_at, recheck_through
  ) values (
    p_collection_id, p_match_key, 'building', '-infinity',
    '00000000-0000-0000-0000-000000000000', 0, v_total, now(), null, now(), v_recheck
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
    updated_at = now(),
    recheck_through = excluded.recheck_through;
end
$fn$;

-- ---------- Advance: rechecks, then the next chunk ----------

drop function if exists public.advance_collection_matches(uuid, text, text, jsonb, integer);

-- One call is bounded work: at most p_limit queued rechecks and p_limit new
-- emails. Returns
--   outcome: ok | busy (another worker holds this build) | stale (rules
--            changed; caller should reset) | missing (no build row)
--   status:  building (more work left) | ready (caught up)
-- Emails from the last 30 seconds and rechecks queued in the last 5 minutes
-- are left for a later call, so rows committed late with an earlier
-- created_at / id can't be skipped past.
create or replace function public.advance_collection_matches(
  p_collection_id uuid,
  p_match_key text,
  p_combinator text,
  p_filters jsonb,
  p_limit integer default 1000,
  p_flag_new boolean default false
) returns table (outcome text, status text, scanned integer, matched integer)
language plpgsql
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_build public.collection_match_builds%rowtype;
  v_horizon timestamptz := now() - interval '30 seconds';
  v_recheck_horizon timestamptz := now() - interval '5 minutes';
  v_pred text;
  v_count integer := 0;
  v_last_at timestamptz;
  v_last_id uuid;
  v_matched integer := 0;
  v_recheck_count integer := 0;
  v_recheck_max bigint;
  v_email_ids uuid[];
  v_company_ids uuid[];
  v_more boolean;
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

  -- An empty filter list matches nothing.
  v_pred := case
    when jsonb_array_length(p_filters) > 0
      then public.collection_rule_predicate(p_combinator, p_filters)
    else 'false'
  end;

  -- 1. Re-evaluate emails edited since this build last looked, but only
  --    those behind the cursor (the rest get evaluated when it gets there).
  select count(*)::integer, max(q.id),
    array_agg(q.email_id) filter (where q.email_id is not null),
    array_agg(distinct q.company_id) filter (where q.company_id is not null)
  into v_recheck_count, v_recheck_max, v_email_ids, v_company_ids
  from (
    select r.id, r.email_id, r.company_id
    from public.collection_match_rechecks r
    where r.id > v_build.recheck_through
      and r.queued_at <= v_recheck_horizon
    order by r.id
    limit p_limit
  ) q;

  if v_recheck_count > 0 then
    -- A brand edit can only change this rule's result for that brand's
    -- emails if the rule names the brand now (market or brand-name lookup)
    -- or matched some of its emails before.
    if v_company_ids is not null then
      select array_agg(c.id) into v_company_ids
      from unnest(v_company_ids) as c(id)
      where exists (
          select 1
          from jsonb_array_elements(p_filters) f,
            jsonb_array_elements_text(
              coalesce(f -> 'ids', '[]'::jsonb) || coalesce(f -> 'brandIds', '[]'::jsonb)
            ) x
          where x = c.id::text
        )
        or exists (
          select 1
          from public.captured_emails e
          join public.collection_matches m
            on m.collection_id = p_collection_id and m.email_id = e.id
          where e.company_id = c.id
        );
    end if;

    if v_email_ids is not null or v_company_ids is not null then
      execute format(
        $q$
          with s as (
            select e.id, e.received_at, e.created_at, coalesce((%s), false) as hit
            from public.captured_emails e
            where (e.id = any($2) or e.company_id = any($3))
              and (e.created_at, e.id) <= ($4, $5)
          ),
          gone as (
            delete from public.collection_matches m
            using s
            where m.collection_id = $1 and m.email_id = s.id and not s.hit
          )
          insert into public.collection_matches (
            collection_id, email_id, received_at, email_created_at
          )
          select $1, s.id, s.received_at, s.created_at from s where s.hit
          on conflict (collection_id, email_id)
            do update set received_at = excluded.received_at
        $q$,
        v_pred
      )
      using p_collection_id,
        coalesce(v_email_ids, '{}'::uuid[]),
        coalesce(v_company_ids, '{}'::uuid[]),
        v_build.cursor_at, v_build.cursor_id;
    end if;
  end if;

  -- 2. The next chunk of the archive in ingest order.
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

    if v_pred <> 'false' then
      execute format(
        $q$
          insert into public.collection_matches (
            collection_id, email_id, received_at, email_created_at
          )
          select $1, e.id, e.received_at, e.created_at
          from public.captured_emails e
          where e.created_at >= $2
            and e.created_at <= $3
            and (e.created_at, e.id) > ($2, $4)
            and (e.created_at, e.id) <= ($3, $5)
            and (%s)
          on conflict do nothing
        $q$,
        v_pred
      )
      using p_collection_id, v_build.cursor_at, v_last_at,
        v_build.cursor_id, v_last_id;
      get diagnostics v_matched = row_count;
    end if;
  end if;

  -- 3. The sidebar dot: new emails matched by a collection that is already
  --    built (not during its first build or a catch-up the viewer started).
  if p_flag_new and v_build.status = 'ready' and v_matched > 0 then
    update public.collections c
    set has_new_matches = true
    where c.id = p_collection_id and not c.has_new_matches;
  end if;

  v_more := v_count >= p_limit or v_recheck_count >= p_limit;

  update public.collection_match_builds b set
    cursor_at = coalesce(v_last_at, b.cursor_at),
    cursor_id = coalesce(v_last_id, b.cursor_id),
    recheck_through = coalesce(v_recheck_max, b.recheck_through),
    status = case when b.status = 'building' and not v_more then 'ready' else b.status end,
    scanned = case when b.status = 'building' then b.scanned + v_count else b.scanned end,
    ready_at = case
      when b.status = 'building' and not v_more then now()
      else b.ready_at
    end,
    updated_at = now()
  where b.collection_id = p_collection_id;

  return query select
    'ok'::text,
    case when v_more then 'building' else 'ready' end,
    v_count,
    v_matched;
end
$fn$;

-- ---------- Page-side helpers ----------

-- How much a built collection has left to check, each capped at p_cap (the
-- page only needs to know "nothing", "a little" or "a lot").
create or replace function public.collection_match_backlog(
  p_collection_id uuid,
  p_cap integer default 1000
) returns table (emails integer, rechecks integer)
language sql
stable
set search_path = ''
as $fn$
  select
    (
      select count(*)::integer from (
        select 1
        from public.captured_emails e
        where (e.created_at, e.id) > (b.cursor_at, b.cursor_id)
          and e.created_at <= now() - interval '30 seconds'
        limit p_cap
      ) x
    ),
    (
      select count(*)::integer from (
        select 1
        from public.collection_match_rechecks r
        where r.id > b.recheck_through
          and r.queued_at <= now() - interval '5 minutes'
        limit p_cap
      ) y
    )
  from public.collection_match_builds b
  where b.collection_id = p_collection_id
$fn$;

-- Turn a built collection with a big backlog (opened after a long break)
-- into a measurable catch-up: the page shows the progress panel and the
-- worker finishes it. ready_at stays set, which marks it a catch-up.
create or replace function public.start_collection_match_catch_up(
  p_collection_id uuid,
  p_match_key text
) returns void
language sql
set search_path = ''
as $fn$
  update public.collection_match_builds b set
    status = 'building',
    scanned = 0,
    total = (
      select count(*)::integer
      from public.captured_emails e
      where (e.created_at, e.id) > (b.cursor_at, b.cursor_id)
    ),
    started_at = now(),
    updated_at = now()
  where b.collection_id = p_collection_id
    and b.match_key = p_match_key
    and b.status = 'ready'
$fn$;

-- Exact totals for a collection's stored matches within its scope / time
-- window bounds, counting duplicate sends once (as the email grid shows
-- them) and distinct brands.
create or replace function public.collection_match_totals(
  p_collection_id uuid,
  p_gte timestamptz default null,
  p_lt timestamptz default null,
  p_lte timestamptz default null
) returns table (emails integer, brands integer)
language sql
stable
set search_path = ''
as $fn$
  select
    count(distinct coalesce(e.duplicate_of, e.id))::integer,
    count(distinct e.company_id)::integer
  from public.collection_matches m
  join public.captured_emails e on e.id = m.email_id
  where m.collection_id = p_collection_id
    and (p_gte is null or m.received_at >= p_gte)
    and (p_lt is null or m.received_at < p_lt)
    and (p_lte is null or m.received_at <= p_lte)
$fn$;

-- ---------- Worker selection ----------

-- Builds the worker should advance, for collections that aren't dormant:
-- every running build, plus built collections that are behind (new emails
-- or queued rechecks), at most once per 5 minutes each. Running builds
-- first.
create or replace function public.collection_match_builds_due(p_limit integer default 50)
returns table (collection_id uuid)
language sql
stable
set search_path = ''
as $fn$
  with head as (
    select e.created_at, e.id
    from public.captured_emails e
    where e.created_at <= now() - interval '30 seconds'
    order by e.created_at desc, e.id desc
    limit 1
  ),
  queue as (
    select coalesce(max(r.id), 0) as max_id
    from public.collection_match_rechecks r
    where r.queued_at <= now() - interval '5 minutes'
  )
  select b.collection_id
  from public.collection_match_builds b
  join public.collections c on c.id = b.collection_id
  cross join queue q
  left join head h on true
  where (
      b.last_opened_at >= public.collection_match_dormant_before()
      or c.notify_new_matches
    )
    and (
      b.status = 'building'
      or (
        b.updated_at < now() - interval '5 minutes'
        and (
          (b.cursor_at, b.cursor_id) < (h.created_at, h.id)
          or b.recheck_through < q.max_id
        )
      )
    )
  order by (b.status = 'building') desc, b.updated_at
  limit p_limit
$fn$;

-- ---------- Nightly maintenance ----------

create or replace function public.collection_match_maintenance()
returns void
language plpgsql
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  -- Long-dormant collections give up their stored matches; their next
  -- open rebuilds them.
  for v_id in
    select b.collection_id
    from public.collection_match_builds b
    join public.collections c on c.id = b.collection_id
    where b.last_opened_at < now() - interval '90 days'
      and not c.notify_new_matches
  loop
    perform public.reset_collection_matches(v_id, null);
  end loop;

  -- Every remaining build has applied the queue up to its watermark.
  delete from public.collection_match_rechecks r
  where r.id <= coalesce(
    (select min(b.recheck_through) from public.collection_match_builds b),
    (select max(r2.id) from public.collection_match_rechecks r2)
  );
end
$fn$;

select cron.unschedule('collection-match-maintenance')
where exists (select 1 from cron.job where jobname = 'collection-match-maintenance');

select cron.schedule(
  'collection-match-maintenance',
  '27 3 * * *',
  $cron$ select public.collection_match_maintenance() $cron$
);

-- ---------- Grants ----------

revoke all on function public.advance_collection_matches(uuid, text, text, jsonb, integer, boolean) from public, anon, authenticated;
revoke all on function public.collection_match_backlog(uuid, integer) from public, anon, authenticated;
revoke all on function public.start_collection_match_catch_up(uuid, text) from public, anon, authenticated;
revoke all on function public.collection_match_totals(uuid, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.collection_match_maintenance() from public, anon, authenticated;
grant execute on function public.advance_collection_matches(uuid, text, text, jsonb, integer, boolean) to service_role;
grant execute on function public.collection_match_backlog(uuid, integer) to service_role;
grant execute on function public.start_collection_match_catch_up(uuid, text) to service_role;
grant execute on function public.collection_match_totals(uuid, timestamptz, timestamptz, timestamptz) to service_role;

-- ---------- Redundant index ----------

drop index if exists public.captured_emails_created_at_idx;
