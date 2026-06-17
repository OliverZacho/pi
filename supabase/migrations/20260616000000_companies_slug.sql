-- companies.slug: stable, human-readable handle for public SEO URLs
-- (/brands/<slug>). Generated from the brand name, kept stable across
-- renames (only filled when null), and unique across all companies.

-- Pure-SQL slugifier (no unaccent dependency): lowercase, collapse every
-- run of non-alphanumerics to a single hyphen, trim leading/trailing
-- hyphens. Returns NULL when nothing usable survives (e.g. an all-emoji or
-- non-Latin name) so callers can fall back to a default.
create or replace function public.slugify(value text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(both '-' from regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g')),
    ''
  );
$$;

alter table public.companies add column if not exists slug text;

-- Assigns a unique slug to NEW.slug when it's missing. Stable by design:
-- on UPDATE we only generate when slug is still null, so renaming a brand
-- never changes (and never breaks) its public URL. Collisions get a numeric
-- suffix (-1, -2, …).
create or replace function public.companies_set_slug()
returns trigger
language plpgsql
as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  if new.slug is not null and new.slug <> '' then
    return new;
  end if;
  base := coalesce(public.slugify(new.name), 'brand');
  candidate := base;
  while exists (
    select 1 from public.companies c
    where c.slug = candidate and c.id <> new.id
  ) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  new.slug := candidate;
  return new;
end;
$$;

drop trigger if exists companies_set_slug_trg on public.companies;
create trigger companies_set_slug_trg
before insert or update of name, slug on public.companies
for each row
execute function public.companies_set_slug();

-- Backfill existing rows (including soft-deleted ones, so a future restore
-- can't collide with a live slug). Row-by-row so the uniqueness suffixing
-- applies; the table is small.
do $$
declare
  r record;
  base text;
  candidate text;
  n int;
begin
  for r in select id, name from public.companies where slug is null order by created_at loop
    base := coalesce(public.slugify(r.name), 'brand');
    candidate := base;
    n := 0;
    while exists (select 1 from public.companies where slug = candidate) loop
      n := n + 1;
      candidate := base || '-' || n;
    end loop;
    update public.companies set slug = candidate where id = r.id;
  end loop;
end $$;

create unique index if not exists companies_slug_key on public.companies (slug);

alter table public.companies alter column slug set not null;
