-- Per-list scope for brands inside a comparison.
--
-- A competitor_set_members row can optionally pin the brand to one of its
-- mailing-list inboxes (e.g. ARKET → its "Homeware" list), so the comparison
-- reflects just that list instead of the brand's entire output. NULL keeps the
-- prior behaviour: all of the brand's lists aggregated together.
alter table public.competitor_set_members
  add column if not exists inbox_id uuid
  references public.company_inboxes (id) on delete set null;

comment on column public.competitor_set_members.inbox_id is
  'Optional inbox/list scope for this brand in the comparison. NULL = all lists (the brand''s full output).';
