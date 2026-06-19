-- Allow a brand in a comparison to be scoped to MULTIPLE lists, not just one.
--
-- Supersedes the single `inbox_id` column added in
-- 20260619120000_competitor_member_inbox.sql. A member can now pin a brand to
-- a subset of its mailing lists (e.g. ARKET → "Men" + "Women"), or to all of
-- them (NULL / empty array). No FK on the array elements — getBrandPageData
-- validates ids against the brand's real segments at read time.
alter table public.competitor_set_members
  add column if not exists inbox_ids uuid[];

-- Carry over any single-list scopes set under the previous column.
update public.competitor_set_members
  set inbox_ids = array[inbox_id]
  where inbox_id is not null
    and (inbox_ids is null or cardinality(inbox_ids) = 0);

alter table public.competitor_set_members
  drop column if exists inbox_id;

comment on column public.competitor_set_members.inbox_ids is
  'Optional set of inbox/list scopes for this brand in the comparison. NULL or empty = all lists (the brand''s full output).';
