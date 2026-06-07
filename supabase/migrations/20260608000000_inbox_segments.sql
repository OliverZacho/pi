-- Per-inbox subscription "segments".
--
-- A single brand often runs more than one mailing list, sliced either by
-- product line (Arket: jewellery / fashion / furniture) or by country
-- (Nike: US / DK / …). We already model one brand as one `companies` row
-- with many `company_inboxes` (one address per list we subscribe to), and
-- every captured email already carries the `inbox_id` it arrived on. What
-- was missing is *meaning* on the inbox: which product line / country a
-- given list represents.
--
-- This migration promotes inboxes into first-class segments by tagging
-- each one with an optional product-line category and/or country, plus a
-- human label for the UI switcher. To keep the hot read paths (Explore
-- filtering, brand-page scoping) off a join, we denormalise the two
-- filterable fields onto `captured_emails` and keep them in sync with a
-- trigger when an operator re-tags an inbox.
--
-- Naming note: `captured_emails.category` is the email *type* taxonomy
-- (sale / launch / content …) and is unrelated. "Segment" is deliberately
-- a distinct word so the two axes never get conflated.

-- ---------------------------------------------------------------------------
-- company_inboxes: the segment definition lives here (the source of truth).
-- All three columns are nullable — an un-segmented inbox (the common case
-- for single-list brands) simply leaves them NULL and behaves exactly as
-- before. segment_category mirrors the lower-cased vocabulary of
-- companies.markets; segment_country is ISO 3166-1 alpha-2 (uppercase).
-- ---------------------------------------------------------------------------
alter table public.company_inboxes
  add column if not exists segment_label text,
  add column if not exists segment_category text,
  add column if not exists segment_country text;

alter table public.company_inboxes
  drop constraint if exists company_inboxes_segment_country_format;
alter table public.company_inboxes
  add constraint company_inboxes_segment_country_format
    check (segment_country is null or segment_country ~ '^[A-Z]{2}$');

create index if not exists company_inboxes_segment_category_idx
  on public.company_inboxes (segment_category)
  where segment_category is not null;

-- ---------------------------------------------------------------------------
-- captured_emails: denormalised copy of the matched inbox's segment so the
-- Explore market filter and the brand-page segment scope can run as plain
-- indexed predicates instead of a join through company_inboxes. Written at
-- ingest (see lib/admin-db.ts storeProcessedEmail) and kept in sync by the
-- trigger below when an inbox is re-tagged.
-- ---------------------------------------------------------------------------
alter table public.captured_emails
  add column if not exists segment_category text,
  add column if not exists segment_country text;

alter table public.captured_emails
  drop constraint if exists captured_emails_segment_country_format;
alter table public.captured_emails
  add constraint captured_emails_segment_country_format
    check (segment_country is null or segment_country ~ '^[A-Z]{2}$');

create index if not exists captured_emails_segment_category_idx
  on public.captured_emails (segment_category)
  where segment_category is not null;

create index if not exists captured_emails_segment_country_idx
  on public.captured_emails (segment_country)
  where segment_country is not null;

-- Backfill existing emails from their matched inbox. A no-op today (no
-- inbox carries a segment yet) but it makes the migration idempotent if it
-- is re-run after inboxes have been tagged, and documents the relationship.
update public.captured_emails e
   set segment_category = i.segment_category,
       segment_country = i.segment_country
  from public.company_inboxes i
 where e.inbox_id = i.id
   and (e.segment_category is distinct from i.segment_category
        or e.segment_country is distinct from i.segment_country);

-- ---------------------------------------------------------------------------
-- Keep the denormalised copy in sync when an operator re-tags an inbox.
-- Ingest stamps new emails directly; this trigger only fires for the much
-- rarer "admin changed a segment" event, so a full rewrite of the inbox's
-- emails is fine.
-- ---------------------------------------------------------------------------
create or replace function public.sync_email_segment_from_inbox()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.segment_category is distinct from old.segment_category
     or new.segment_country is distinct from old.segment_country then
    update public.captured_emails
       set segment_category = new.segment_category,
           segment_country = new.segment_country
     where inbox_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists company_inboxes_sync_email_segment on public.company_inboxes;
create trigger company_inboxes_sync_email_segment
  after update on public.company_inboxes
  for each row
  execute function public.sync_email_segment_from_inbox();
