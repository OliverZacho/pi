-- Faster smart-collection match builds.
--
-- advance_collection_matches tested each email through
-- collection_rule_matches(), a SQL function that can't be inlined (its
-- `set search_path` pins it), so every email paid two levels of function
-- calls plus a jsonb walk. Measured 2026-11-08 at ~20k emails: 580 to 1,670ms
-- per 1,000-email chunk through the function vs 58ms for the same ilike
-- written inline, so a full build ran at ~400 emails/s.
--
-- Now the rule is compiled ONCE per chunk into a plain SQL predicate
-- (collection_rule_predicate, every value passed through format('%L')) and
-- the chunk insert runs as dynamic SQL, so Postgres evaluates the ilike /
-- equality checks natively.

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
        v_part := format(
          'e.search_text ilike %L or e.company_id = any(%L::uuid[])',
          '%' || (f ->> 'pattern') || '%',
          array(select jsonb_array_elements_text(coalesce(f -> 'brandIds', '[]'::jsonb)))
        );
      else
        v_part := 'false';
    end case;
    -- NULL columns count as no match, same as the old evaluator.
    v_parts := v_parts || format('coalesce((%s), false)', v_part);
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
        public.collection_rule_predicate(p_combinator, p_filters)
      )
      using p_collection_id, v_build.cursor_at, v_last_at,
        v_build.cursor_id, v_last_id;
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

drop function if exists public.collection_rule_matches(text, jsonb, text, text, text, uuid, numeric);
drop function if exists public.collection_filter_matches(jsonb, text, text, text, uuid, numeric);

revoke all on function public.collection_rule_predicate(text, jsonb) from public, anon, authenticated;
grant execute on function public.collection_rule_predicate(text, jsonb) to service_role;
