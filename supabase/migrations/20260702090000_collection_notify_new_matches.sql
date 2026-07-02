-- Pirol — per-collection opt-in for the "new matches in a smart
-- collection" notification.
--
-- Off by default: a smart collection emails nothing until its owner turns
-- updates on (from the collection page or the Settings checklist). The
-- notification job filters on this flag, so the smartCollection cadence
-- only acts on collections the user explicitly chose.

alter table public.collections
  add column if not exists notify_new_matches boolean not null default false;
