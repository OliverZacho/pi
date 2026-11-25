-- ---------------------------------------------------------------------------
-- Covering index for the /docs archive insights snapshot.
--
-- The snapshot (20261125190100_docs_archive_insights.sql) rolls up the newest
-- de-duplicated sends per brand. Read from the table itself that means
-- touching ~13,000 heap pages of captured_emails, because each row sits next
-- to its email HTML: measured on 2026-11-25 at 3 to 22 seconds on this
-- instance depending on how warm the connection was. These five small columns
-- fit in an index of a few hundred pages, so the refresh is an index-only
-- scan instead.
--
-- CONCURRENTLY so ingest keeps inserting while it builds. That can't run in a
-- transaction block: apply this file on its own, outside one.
-- ---------------------------------------------------------------------------

create index concurrently if not exists captured_emails_insight_sample_idx
  on public.captured_emails (received_at desc)
  include (company_id, esp_provider, discount_percent, category)
  where duplicate_of is null;
