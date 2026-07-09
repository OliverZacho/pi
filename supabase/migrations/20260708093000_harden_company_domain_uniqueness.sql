-- Harden brand-domain uniqueness.
--
-- The old index enforced uniqueness on `lower(domain)` across ALL rows, so two
-- records for the same brand slipped through whenever the stored domain differed
-- only by protocol, `www.`, a trailing slash, or a query string — e.g.
-- `https://operasport.net/` vs `operasport.net`. That let the same email be
-- captured against two company records and show twice in the feeds.
--
-- Replace it with a unique index on the NORMALIZED host, scoped to active
-- (non-deleted) companies. The normalization mirrors normalizeDomain() in
-- lib/suggest-companies.ts and the guard in createCompanySubscinDb:
--   lower -> strip scheme -> strip path/query -> strip leading www. -> keep [a-z0-9.-]
--
-- Scoping to `deleted_at is null` also lets a domain be re-subscribed after a
-- soft delete, which the old all-rows index blocked.
--
-- Precondition (verified before authoring): there are no remaining active
-- normalized-domain collisions, so this index builds cleanly.

drop index if exists companies_domain_unique;

create unique index companies_domain_unique
on public.companies (
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(domain), '^https?://', ''),
      '[/?].*$', ''),
    '^www\.', ''),
  '[^a-z0-9.-]', '', 'g')
)
where deleted_at is null;
