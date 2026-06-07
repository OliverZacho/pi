-- Identical-campaign de-duplication.
--
-- Brands that slice their program into several mailing lists (Arket:
-- Women / Men / Children / Homeware) fire the *same* email — e.g. the
-- welcome blast — once per list. Each copy lands as its own
-- captured_emails row (distinct inbox_id / segment), so feed surfaces
-- (Explore, the brand page's recent-campaigns thumbnails) showed the
-- same email N times.
--
-- We fingerprint each email's content and link the later copies to the
-- earliest one in the group via `duplicate_of`. Feed surfaces filter
-- `duplicate_of IS NULL` so an identical send shows once; per-list brand
-- tabs (which scope by inbox_id) keep showing each list's own copy.
--
-- The fingerprint is subject + plain text with URLs stripped — the only
-- thing that differs between copies is per-recipient tracking links, so
-- removing URLs makes the visible content compare equal. All of this is
-- computed at write time (trigger), so the read path stays a plain
-- indexed filter with zero added work.

alter table public.captured_emails
  add column if not exists content_hash text,
  add column if not exists duplicate_of uuid
    references public.captured_emails (id) on delete set null;

comment on column public.captured_emails.content_hash is
  'Fingerprint of subject + URL-stripped plain text. Identical campaign copies sent to different mailing lists hash equal even though their per-recipient tracking links differ. Maintained by the captured_emails_set_dedup trigger.';
comment on column public.captured_emails.duplicate_of is
  'Points at the canonical (earliest) copy when this email is a content-identical duplicate of another from the same brand (e.g. a welcome blast sent to several inbox segments). NULL = canonical / standalone. Feed surfaces filter duplicate_of IS NULL so an identical send shows once; per-list brand tabs ignore it.';

-- Content fingerprint: lower-cased subject + plain text with every URL
-- and whitespace run collapsed to a single space. IMMUTABLE so it can be
-- reused in the backfill and is safe to call from the trigger.
create or replace function public.captured_email_content_hash(
  p_subject text,
  p_plain_text text
)
returns text
language sql
immutable
as $$
  select md5(
    lower(
      regexp_replace(
        coalesce(p_subject, '') || ' ' || coalesce(p_plain_text, ''),
        'https?://[^\s]+|\s+',
        ' ',
        'g'
      )
    )
  );
$$;

-- BEFORE INSERT: stamp the fingerprint and, if an earlier copy from the
-- same brand already carries it, point this row at that canonical copy.
-- A generated column can't be read from a BEFORE trigger, so the hash is
-- a plain column the trigger fills in.
create or replace function public.captured_emails_set_dedup()
returns trigger
language plpgsql
as $$
begin
  new.content_hash :=
    public.captured_email_content_hash(new.subject, new.plain_text);

  if new.company_id is not null then
    select c.id
      into new.duplicate_of
      from public.captured_emails c
     where c.company_id = new.company_id
       and c.content_hash = new.content_hash
       and c.duplicate_of is null
       and c.id <> new.id
     order by c.received_at asc, c.id asc
     limit 1;
  else
    new.duplicate_of := null;
  end if;

  return new;
end;
$$;

drop trigger if exists captured_emails_set_dedup on public.captured_emails;
create trigger captured_emails_set_dedup
  before insert on public.captured_emails
  for each row
  execute function public.captured_emails_set_dedup();

-- Index the dedup lookup (trigger) and the canonical filter (feeds).
create index if not exists captured_emails_company_content_hash_idx
  on public.captured_emails (company_id, content_hash);
create index if not exists captured_emails_duplicate_of_idx
  on public.captured_emails (duplicate_of);

-- Backfill: fingerprint every existing row, then link each group's later
-- copies to its earliest member.
update public.captured_emails
   set content_hash = public.captured_email_content_hash(subject, plain_text)
 where content_hash is null;

with ranked as (
  select
    id,
    first_value(id) over (
      partition by company_id, content_hash
      order by received_at asc, id asc
    ) as canonical_id
  from public.captured_emails
  where company_id is not null
)
update public.captured_emails ce
   set duplicate_of = ranked.canonical_id
  from ranked
 where ce.id = ranked.id
   and ranked.canonical_id <> ce.id;
