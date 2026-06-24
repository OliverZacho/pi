-- Byte sizes for a set of email-asset storage objects.
--
-- The render path uses this to decide which images are worth running through
-- Cloudflare Image Resizing: resizing a sub-100KB logo/icon/spacer burns a
-- billable transformation for ~no byte saving, so the card-preview render
-- skips the transform for small assets and only resizes the large ones.
--
-- `storage.objects` isn't exposed through the API, so callers can't read it
-- directly; this SECURITY DEFINER function reads it on their behalf, scoped
-- to the `email-assets` bucket. The data (sizes of content-addressed public
-- assets) is non-sensitive, so it's granted broadly.
create or replace function public.email_asset_sizes(p_paths text[])
returns table(name text, size bigint)
language sql
security definer
set search_path = ''
as $$
  select o.name, (o.metadata->>'size')::bigint as size
  from storage.objects o
  where o.bucket_id = 'email-assets'
    and o.name = any(p_paths);
$$;

grant execute on function public.email_asset_sizes(text[])
  to anon, authenticated, service_role;
