-- Group-aware product-line filtering for de-duplicated sends.
--
-- A multi-list send (e.g. Arket's welcome blast to Women / Men /
-- Children / Homeware) collapses to a single canonical row in Explore
-- (see 20260608020000). But the copies carry *different* segments —
-- the canonical might be the "home & living" copy while a "fashion"
-- copy is one of its duplicates. Filtering Explore by "fashion" used to
-- match only the canonical's own segment, so the collapsed email
-- vanished even though it genuinely went to the fashion list.
--
-- We denormalise the whole group's distinct segments onto every row in
-- the group (`group_segment_categories`) and point the Explore filter at
-- that array instead of the scalar `segment_category`. The array is
-- maintained at write time by triggers, so the read path stays a single
-- GIN-indexed overlap — no joins, no per-row fan-out.
--
-- NULL (not an empty array) means "the group carries no segment at all",
-- mirroring the old `segment_category IS NULL` brand-level fallback so
-- un-segmented emails keep showing under any product-line filter.

alter table public.captured_emails
  add column if not exists group_segment_categories text[];

comment on column public.captured_emails.group_segment_categories is
  'Distinct, non-null segment_category values across this email''s de-dup group (itself + every copy sharing its canonical). NULL when the group has no segment. Explore''s product-line filter overlaps this so a collapsed multi-list send matches under any list it was sent to. Maintained by the captured_emails_sync_group_segments triggers.';

-- The group''s segment set, given a canonical id. STABLE: reads the table.
create or replace function public.captured_email_group_segments(p_canonical uuid)
returns text[]
language sql
stable
as $$
  select array_agg(distinct c.segment_category)
           filter (where c.segment_category is not null)
    from public.captured_emails c
   where c.id = p_canonical
      or c.duplicate_of = p_canonical;
$$;

-- Recompute every group member's array from the current segment set.
-- Only writes `group_segment_categories`, so it never re-fires the
-- segment_category/duplicate_of UPDATE trigger (no recursion). The
-- `is distinct from` guard skips rows already correct.
create or replace function public.captured_emails_sync_group_segments()
returns trigger
language plpgsql
as $$
declare
  v_canonical uuid;
  v_segs text[];
begin
  v_canonical := coalesce(new.duplicate_of, new.id);
  v_segs := public.captured_email_group_segments(v_canonical);

  update public.captured_emails c
     set group_segment_categories = v_segs
   where (c.id = v_canonical or c.duplicate_of = v_canonical)
     and c.group_segment_categories is distinct from v_segs;

  return null;
end;
$$;

drop trigger if exists captured_emails_group_segments_ins on public.captured_emails;
create trigger captured_emails_group_segments_ins
  after insert on public.captured_emails
  for each row
  execute function public.captured_emails_sync_group_segments();

drop trigger if exists captured_emails_group_segments_upd on public.captured_emails;
create trigger captured_emails_group_segments_upd
  after update of segment_category, duplicate_of on public.captured_emails
  for each row
  when (
    old.segment_category is distinct from new.segment_category
    or old.duplicate_of is distinct from new.duplicate_of
  )
  execute function public.captured_emails_sync_group_segments();

create index if not exists captured_emails_group_segment_categories_idx
  on public.captured_emails using gin (group_segment_categories);

-- Backfill every existing group. array_agg(... ) filter (...) yields NULL
-- when a group has no segment, which is exactly the "no segment" sentinel.
with groups as (
  select
    coalesce(duplicate_of, id) as canonical_id,
    array_agg(distinct segment_category) filter (where segment_category is not null) as segs
  from public.captured_emails
  group by coalesce(duplicate_of, id)
)
update public.captured_emails ce
   set group_segment_categories = groups.segs
  from groups
 where coalesce(ce.duplicate_of, ce.id) = groups.canonical_id
   and ce.group_segment_categories is distinct from groups.segs;
