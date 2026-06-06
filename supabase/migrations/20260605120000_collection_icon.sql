-- Pirol — Collection icons.
--
-- Let owners pick an emoji to represent a collection (think Pinterest /
-- Notion board glyphs). The value is constrained at the application layer
-- to a curated allow-list (see `lib/collection-icons.ts`); here we only
-- guard against absurdly long input so a malformed write can't bloat the
-- row. `null` means "no custom icon" — the UI falls back to the generic
-- collection glyph, which keeps every pre-existing row rendering exactly
-- as before.

alter table public.collections
  add column if not exists icon text
    check (icon is null or char_length(icon) <= 16);
