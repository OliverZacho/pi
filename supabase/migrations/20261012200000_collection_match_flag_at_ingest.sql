-- ============================================================
-- Replaces the per-render cursor from 20261012190000 with ingest-time
-- flagging: the ingest processor tests each new email against every smart
-- collection (a primary-key lookup per rule) and sets has_new_matches on
-- the ones it matches; the sidebar only reads the flag. The cursor column
-- is no longer used.
--
-- has_new_matches stays, and the updated_at trigger keeps ignoring writes
-- that only touch it: ingest flagging a collection is not the owner using
-- it, and the sidebar orders by updated_at.
-- ============================================================

alter table public.collections
  drop column if exists new_matches_checked_at;

create or replace function public.collections_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (to_jsonb(new) - array['has_new_matches', 'updated_at'])
     = (to_jsonb(old) - array['has_new_matches', 'updated_at']) then
    new.updated_at = old.updated_at;
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;
