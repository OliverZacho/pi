-- Normalize historical image_mirror_map storage paths to the dedup layout.
--
-- ~197 emails captured before the storage path-dedup migration still store
-- their `image_mirror_map` values in the old `${emailId}/${sha}${ext}` layout,
-- while `image_urls` and the actual storage objects use the flat, content-
-- addressed `${sha}${ext}` layout. The render pipeline keys signed URLs by the
-- dedup path, so these old values resolved no signed URL and every image fell
-- back to its remote host — which the email-preview CSP now blocks, rendering
-- those emails as a wall of broken images.
--
-- The renderer was made tolerant of this in lib/email-render.ts (basename
-- fallback), but the stale paths also trip other consumers (logo backfill,
-- debug tooling). This rewrites each map value to its basename so the data is
-- canonical. Verified beforehand: all 2354 affected entries' basenames exist in
-- storage.objects, and none of the old `${emailId}/...` paths do.
--
-- Idempotent: values without a slash are returned unchanged, so re-running is a
-- no-op.

update captured_emails c
set metadata = jsonb_set(
  c.metadata,
  '{image_mirror_map}',
  (
    select jsonb_object_agg(key, regexp_replace(value, '^.*/', ''))
    from jsonb_each_text(c.metadata->'image_mirror_map')
  )
)
where c.metadata ? 'image_mirror_map'
  and exists (
    select 1
    from jsonb_each_text(c.metadata->'image_mirror_map') v
    where v.value like '%/%'
  );
