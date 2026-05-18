-- Pirol — track List-Unsubscribe / List-Unsubscribe-Post / List-Id presence.
--
-- These are the bulk-sender disclosure headers that mailbox providers care
-- about — most notably the inputs Apple Mail uses to render its built-in
-- "Unsubscribe" button + the "This message is from a mailing list" badge,
-- and the inputs Gmail / Yahoo's 2024 bulk-sender rules require (RFC 8058
-- one-click). Stored as JSONB rather than booleans so we can also capture the
-- parsed mailto:/https URIs and the inner List-Id value alongside the flags.
--
-- Forward-only: existing rows stay `NULL` (unknown) until they're re-ingested
-- or explicitly backfilled. A populated row with everything `false` / `null`
-- means we *did* inspect the headers and these signals were genuinely absent
-- — which is the case worth flagging in the UI.

alter table public.captured_emails
  add column if not exists list_headers jsonb;

-- Partial index on rows that we know are missing the basic Apple-Mail
-- Unsubscribe input. Lets the UI / future analytics quickly answer "which
-- recently-received emails would Apple flag as missing the mailing-list
-- disclosure?" without scanning the whole table.
create index if not exists captured_emails_list_unsubscribe_missing_idx
  on public.captured_emails (received_at desc)
  where list_headers is not null
    and (list_headers ->> 'has_list_unsubscribe')::boolean is not true;
