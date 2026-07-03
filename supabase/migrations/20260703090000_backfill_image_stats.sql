-- Backfill `metadata.image_stats` for emails captured before ingest started
-- writing it (lib/ingest-processor.ts). Bytes come from `storage.objects`
-- metadata in the `email-assets` bucket; format is derived from the storage
-- path extension (paths are content addressed as `{sha1}{ext}`, so the
-- extension is always present — junk extensions from URL fallbacks land in
-- the `other` bucket, mirroring `formatFromPath` in lib/image-stats.ts).
--
-- Idempotent: the `not (metadata ? 'image_stats')` guard skips rows ingest
-- has already stamped, so re-runs and the deploy/migration window are safe.
-- On shadow/local databases `storage.objects` is empty and this is a no-op.
with asset as (
  select e.id as email_id,
         o.name as path,
         coalesce((o.metadata->>'size')::bigint, 0) as bytes,
         case
           when o.name ilike '%.jpg' or o.name ilike '%.jpeg' then 'jpeg'
           when o.name ilike '%.png'  then 'png'
           when o.name ilike '%.gif'  then 'gif'
           when o.name ilike '%.webp' then 'webp'
           when o.name ilike '%.avif' then 'avif'
           when o.name ilike '%.svg'  then 'svg'
           else 'other'
         end as format
  from public.captured_emails e
  cross join lateral unnest(e.image_urls) as u(path)
  join storage.objects o
    on o.bucket_id = 'email-assets' and o.name = u.path
  where coalesce(array_length(e.image_urls, 1), 0) > 0
    and not (coalesce(e.metadata, '{}'::jsonb) ? 'image_stats')
),
fmt as (
  select email_id, format, count(*) as cnt, sum(bytes) as bytes
  from asset
  group by email_id, format
),
per_email as (
  select a.email_id,
         jsonb_build_object(
           'total_bytes', sum(a.bytes),
           'image_count', count(*),
           'formats', (
             select jsonb_object_agg(
                      f.format,
                      jsonb_build_object('count', f.cnt, 'bytes', f.bytes)
                    )
             from fmt f
             where f.email_id = a.email_id
           ),
           'assets', jsonb_agg(
             jsonb_build_object('path', a.path, 'bytes', a.bytes, 'format', a.format)
             order by a.bytes desc
           )
         ) as image_stats
  from asset a
  group by a.email_id
)
update public.captured_emails e
set metadata = coalesce(e.metadata, '{}'::jsonb)
             || jsonb_build_object('image_stats', p.image_stats)
from per_email p
where p.email_id = e.id;
