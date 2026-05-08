-- Pirol taxonomy + market scaffolding.
-- Updates the captured_emails category enum to the new business-aligned taxonomy,
-- adds a per-email subcategory tag for vertical-specific taxonomies (e.g. museum
-- "new exhibitions"), adds a market field on companies, and exposes a
-- company_email_stats view so the admin overview can render counts + last email
-- timestamp without N+1 queries.

-- ---------------------------------------------------------------------------
-- captured_emails: new category check + subcategory column.
-- ---------------------------------------------------------------------------
alter table public.captured_emails
  drop constraint if exists captured_emails_category_check;

-- Reset any pre-existing rows to 'other' so the new check passes regardless of
-- legacy values. Safe in this codebase because no production data exists yet.
update public.captured_emails
set category = 'other'
where category not in (
  'sale',
  'product_launch',
  'event',
  'content',
  'loyalty',
  'transactional',
  'seasonal',
  'partnership',
  'company_news',
  'other'
);

alter table public.captured_emails
  add constraint captured_emails_category_check
  check (category in (
    'sale',
    'product_launch',
    'event',
    'content',
    'loyalty',
    'transactional',
    'seasonal',
    'partnership',
    'company_news',
    'other'
  ));

alter table public.captured_emails
  add column if not exists subcategory text;

-- ---------------------------------------------------------------------------
-- companies: optional market label (free-text vertical, lower-cased on insert).
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists market text;

-- ---------------------------------------------------------------------------
-- company_email_stats: aggregate view used by the admin overview to fetch
-- per-company email counts + most-recent received_at in a single query.
-- ---------------------------------------------------------------------------
create or replace view public.company_email_stats as
select
  company_id,
  count(*)::int as email_count,
  max(received_at) as last_received_at
from public.captured_emails
where company_id is not null
group by company_id;

grant select on public.company_email_stats to authenticated;
grant select on public.company_email_stats to service_role;
