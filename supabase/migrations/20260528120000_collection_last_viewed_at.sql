-- Track when the owner last opened a collection so the sidebar can
-- show a "new emails" indicator for rule-based (auto-populated) lists.

alter table public.collections
  add column if not exists last_viewed_at timestamptz;
