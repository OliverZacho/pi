-- Pirol derived-logo origin tracking.
-- When an admin inverts a white/light logo, the stored `logo_storage_path`
-- points at a baked asset that never appears in the brand's emails. To keep
-- staleness detection working, `logo_origin_path` records the *source* image the
-- pick derives from (the one that does appear in mail). For direct picks it is
-- null and staleness falls back to `logo_storage_path`.

alter table public.companies
  add column if not exists logo_origin_path text;
