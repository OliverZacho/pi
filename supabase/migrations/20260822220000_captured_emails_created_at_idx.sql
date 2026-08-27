-- Index ingest time so "new since last viewed" checks skip the search index.
--
-- The sidebar's "new emails" dot asks, per rule-based collection, whether
-- any email matching the rules was ingested after last_viewed_at. Without
-- this index the planner drives that query through the search_text trigram
-- GIN (~1s when cold on this compute size, per smart collection, per page
-- load). last_viewed_at is usually recent, so `created_at > $ts` matches a
-- handful of rows; a btree lets the planner scan those and apply the search
-- as a cheap per-row filter instead.

create index if not exists captured_emails_created_at_idx
  on public.captured_emails (created_at desc);
