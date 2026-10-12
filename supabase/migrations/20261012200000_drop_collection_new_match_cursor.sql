-- ============================================================
-- Reverts 20261012190000: the sidebar "new emails" dot is gone, so its
-- cursor columns are unused. updated_at goes back to bumping on every
-- update, as it did before the cursor existed.
-- ============================================================

alter table public.collections
  drop column if exists has_new_matches,
  drop column if exists new_matches_checked_at;

create or replace function public.collections_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
