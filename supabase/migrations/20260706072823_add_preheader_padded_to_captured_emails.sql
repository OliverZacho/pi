-- Tracks the "preheader padding" trick: the sender followed their preview
-- teaser with a run of invisible characters (figure space + combining
-- grapheme joiner, zwnj/nbsp pairs, etc.) so inbox previews show only the
-- chosen text. Written at ingest by lib/extract-metadata.ts's
-- detectPreheaderPadding(); NULL means not yet measured.
alter table captured_emails add column if not exists preheader_padded boolean;
