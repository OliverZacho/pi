-- ============================================================
-- Incremental sidebar "new emails" dot for rule-based collections.
--
-- The dot was computed on every app page render by re-running each smart
-- collection's rules over every email created since the owner last opened
-- it. A search rule is an ILIKE over search_text (~6KB a row), and with no
-- cursor that window only grew: seven keyword collections last opened
-- weeks ago meant seven parallel scans of 7k-13k rows per navigation,
-- which hit the 8s timeout and starved Explore's own queries of CPU
-- (2026-10-12: /explore error page, collection rule save failing).
--
-- has_new_matches latches the dot once a match is found (cleared when the
-- collection is viewed or its rules are saved), and new_matches_checked_at
-- is the cursor: the next check only scans emails created after it.
-- ============================================================

alter table public.collections
  add column if not exists has_new_matches boolean not null default false,
  add column if not exists new_matches_checked_at timestamptz;

-- The cursor advances on page renders, which must not count as "using" the
-- collection: the sidebar orders by updated_at. Skip the bump when nothing
-- but the dot cache changed.
create or replace function public.collections_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (to_jsonb(new) - array['has_new_matches', 'new_matches_checked_at', 'updated_at'])
     = (to_jsonb(old) - array['has_new_matches', 'new_matches_checked_at', 'updated_at']) then
    new.updated_at = old.updated_at;
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;
