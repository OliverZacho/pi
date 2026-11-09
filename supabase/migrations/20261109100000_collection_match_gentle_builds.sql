-- Smart collection builds that don't starve the rest of the database.
--
-- On 2026-11-08 three builds ran at once on the Micro instance (500 IOPS
-- baseline) and Explore's queries hit the 8s statement timeout. Every build
-- step read the search_text of every email in its chunk from TOAST, scattered
-- reads at ~2 MB/s when cold, even for a rule like "Black Friday" that only
-- 283 of 19,646 emails could match.
--
-- 1. Index-driven steps. collection_rule_predicate no longer wraps each
--    condition in coalesce(...), which hid the condition from the planner.
--    (In a WHERE clause of AND/OR conditions without NOT, a NULL condition
--    already counts as no match, so results are unchanged; the recheck path
--    keeps its own coalesce for the true/false it needs.) A step bounded
--    by a (created_at, id) range now plans as a BitmapAnd of the trigram
--    index and the created_at index, so text is read only for candidates
--    inside the step: measured 157 rows from 282 candidates for
--    "black friday" over the whole archive, instead of reading 19,646 texts.
--    Rules the index can't help with (a pattern under 3 characters, or OR
--    with a condition that has no index) fall back to reading the chunk,
--    same as before.
--
-- 2. One build step at a time, with a pause. A step of a building
--    collection (first build or catch-up) takes a database-wide advisory
--    lock and checks collection_match_build_gate; when either is taken it
--    returns outcome 'queued' right away. After a step, the gate stays shut
--    for as long as the step took, so builds use at most about half of the
--    database's time however many are waiting. Keeping built collections
--    current (a handful of new, still-cached emails) isn't gated.

-- ---------- Predicate without coalesce ----------

create or replace function public.collection_rule_predicate(
  p_combinator text,
  p_filters jsonb
) returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  f jsonb;
  v_parts text[] := '{}';
  v_part text;
  v_op text;
  v_brand_ids text[];
begin
  for f in select value from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb))
  loop
    case f ->> 'type'
      when 'category_in' then
        v_part := format(
          'e.category = any(%L::text[])',
          array(select jsonb_array_elements_text(f -> 'values'))
        );
      when 'country_in' then
        v_part := format(
          'e.detected_country = any(%L::text[])',
          array(select jsonb_array_elements_text(f -> 'values'))
        );
      when 'in_company' then
        v_part := format(
          'e.company_id = any(%L::uuid[])',
          array(select jsonb_array_elements_text(f -> 'ids'))
        );
      when 'discount' then
        v_op := case f ->> 'op' when 'gte' then '>=' when 'lte' then '<=' else '=' end;
        v_part := format('e.discount_percent %s %L::numeric', v_op, f ->> 'value');
      when 'search' then
        v_brand_ids := array(
          select jsonb_array_elements_text(coalesce(f -> 'brandIds', '[]'::jsonb))
        );
        v_part := format('e.search_text ilike %L', '%' || (f ->> 'pattern') || '%');
        if cardinality(v_brand_ids) > 0 then
          v_part := format('%s or e.company_id = any(%L::uuid[])', v_part, v_brand_ids);
        end if;
      else
        v_part := 'false';
    end case;
    v_parts := v_parts || format('(%s)', v_part);
  end loop;

  if cardinality(v_parts) = 0 then
    return 'false';
  end if;
  return array_to_string(
    v_parts,
    case when p_combinator = 'OR' then ' or ' else ' and ' end
  );
end
$fn$;

-- ---------- The gate ----------

create table if not exists public.collection_match_build_gate (
  id boolean primary key default true check (id),
  -- No build step starts before this.
  next_at timestamptz not null default '-infinity'
);

insert into public.collection_match_build_gate (id) values (true)
on conflict (id) do nothing;

alter table public.collection_match_build_gate enable row level security;
revoke all on public.collection_match_build_gate from anon, authenticated;

-- ---------- advance_collection_matches ----------

-- Same contract as before, plus outcome 'queued': another build step is
-- running or the pause after one hasn't passed; try again shortly.
-- p_limit sizes the archive step (the caller adapts it to how long steps
-- take); rechecks stay at 1,000 per call.
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
  v_recheck_limit constant integer := 1000;
  v_gated boolean;
  v_step_started timestamptz;
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

  -- Builds and catch-ups go one step at a time, database-wide.
  v_gated := v_build.status = 'building';
  if v_gated then
    if not pg_try_advisory_xact_lock(hashtextextended('collection_match_build', 0))
      or clock_timestamp() < (
        select g.next_at from public.collection_match_build_gate g where g.id
      )
    then
      return query select 'queued'::text, v_build.status, 0, 0;
      return;
    end if;
    v_step_started := clock_timestamp();
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
    limit v_recheck_limit
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

  -- 2. The next step of the archive in ingest order. The bounds come from
  --    the (created_at, id) index alone; the insert then lets the planner
  --    combine that range with the rule's own indexes.
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

  v_more := v_count >= p_limit or v_recheck_count >= v_recheck_limit;

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

  -- 4. Rest as long as this step worked (at least 100ms) before the next
  --    build step anywhere may start.
  if v_gated then
    update public.collection_match_build_gate g
    set next_at = clock_timestamp()
      + greatest(clock_timestamp() - v_step_started, interval '100 milliseconds')
    where g.id;
  end if;

  return query select
    'ok'::text,
    case when v_more then 'building' else 'ready' end,
    v_count,
    v_matched;
end
$fn$;

revoke all on function public.advance_collection_matches(uuid, text, text, jsonb, integer, boolean) from public, anon, authenticated;
grant execute on function public.advance_collection_matches(uuid, text, text, jsonb, integer, boolean) to service_role;
