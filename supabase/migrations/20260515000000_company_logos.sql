-- Pirol company logos migration.
-- Adds logo fields to public.companies so each subscribed company can carry a
-- logo asset mirrored into the existing email-assets bucket under
-- logos/{companyId}/... — populated lazily by the ingest pipeline as we
-- extract logos from real emails.
--
-- logo_source semantics:
--   email_heuristic - picked from a single email via DOM/url/alt scoring
--   email_frequency - reinforced by appearing in many emails for the brand
--   manual          - admin override; never auto-replaced

alter table public.companies
  add column if not exists logo_storage_path text,
  add column if not exists logo_source text,
  add column if not exists logo_confidence numeric(4, 3),
  add column if not exists logo_updated_at timestamptz;

alter table public.companies
  drop constraint if exists companies_logo_source_check;

alter table public.companies
  add constraint companies_logo_source_check
  check (
    logo_source is null
    or logo_source in (
      'email_heuristic',
      'email_frequency',
      'manual'
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'companies_logo_confidence_range'
  ) then
    alter table public.companies
      add constraint companies_logo_confidence_range
      check (
        logo_confidence is null
        or (logo_confidence >= 0 and logo_confidence <= 1)
      );
  end if;
end $$;

create index if not exists companies_logo_missing_idx
  on public.companies (id)
  where logo_storage_path is null and deleted_at is null;
