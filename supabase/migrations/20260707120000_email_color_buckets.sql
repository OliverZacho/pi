-- Perceptual colour buckets for the Explore colour filter.
--
-- Each email's palette (metadata.image_palette, HTML palette_colors fallback)
-- is folded into a small fixed set of perceptual buckets — red, yellow, green,
-- blue, purple, pink, beige, black — keeping only the colours the email is
-- prominently made of. See lib/color-buckets.ts for the classifier.
--
-- Stored as a text[] rather than in the metadata JSONB so the Explore query can
-- filter with a plain, GIN-indexed array overlap (color_buckets && '{beige}').
-- Additive and nullable: null means "not classified yet" (older rows until the
-- backfill runs); the filter simply doesn't match them.
alter table public.captured_emails
  add column if not exists color_buckets text[];

comment on column public.captured_emails.color_buckets is
  'Prominent perceptual colour buckets the email leans into (subset of red/yellow/green/blue/purple/pink/beige/black), derived from its image/markup palette by lib/color-buckets.ts. Powers the Explore colour filter. Null until classified.';

-- GIN index supports the `&&` (overlap) operator the colour filter uses.
create index if not exists captured_emails_color_buckets_gin_idx
  on public.captured_emails using gin (color_buckets);
