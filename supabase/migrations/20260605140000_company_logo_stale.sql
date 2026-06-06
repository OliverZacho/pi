-- Pirol manual-logo staleness flag.
-- A `manual` logo pick is never auto-replaced, but a brand can rebrand and stop
-- sending the picked image. When the manual logo has been absent from the
-- company's most recent N emails in a row, ingest sets `logo_stale = true` so the
-- brand resurfaces in the admin "Needs logo review" queue. Selecting a logo (or
-- reverting to automatic) clears the flag.

alter table public.companies
  add column if not exists logo_stale boolean not null default false;
