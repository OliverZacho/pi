-- Curated brand allowlist for the Explore "Recommended" sort.
--
-- The Explore page's default "Recommended" ordering is, under the hood, a
-- filter: it restricts the feed to brands an admin has hand-picked as
-- building beautiful emails, then orders those newest-first. This flag is
-- the allowlist. Defaults to false so existing brands stay out of the
-- curated set until an admin opts them in.
alter table public.companies
  add column if not exists is_curated boolean not null default false;

-- Partial index: the "Recommended" sort resolves the (small) set of
-- curated company ids on every Explore landing, so keep that lookup cheap
-- as the companies table grows.
create index if not exists companies_is_curated_idx
  on public.companies (id)
  where is_curated;

comment on column public.companies.is_curated is
  'Admin-curated allowlist for the Explore "Recommended" sort. When true the brand''s emails surface in the curated (default) Explore feed.';
