import {
  EMAIL_PREVIEW_THUMB_TRANSFORM,
  getSignedAssets,
  isTransformablePath,
  type ImageTransform
} from "@/lib/storage";
import { fetchEmailAssetSizes } from "@/lib/admin-db";
import { parseImageStats } from "@/lib/image-stats";
import type { SupabaseAdmin } from "./shared";

/**
 * Resolves one small preview URL per captured email, for embedding next
 * to that email's row in a notification (digest picks, smart-collection
 * samples). Best effort by design: any miss — no stored images, no image
 * big enough to open the email, a failed lookup — simply yields no entry
 * and the row renders text-only, exactly as before.
 */

/**
 * Assets below this size never open a preview. Brand logos, icons, and
 * tracking spacers cluster well under it, while the image an email
 * actually opens with is almost always bigger — without this floor a
 * text-only email would get its logo stretched into a "preview".
 */
const MIN_HERO_BYTES = 15 * 1024;

/**
 * The preview heuristic: the FIRST transformable image, in document
 * order, that clears {@link MIN_HERO_BYTES}. `image_urls` preserves the
 * order the assets appear in the email body, so first-above-the-floor is
 * the email's visible top — cropped from its top edge it reads as "the
 * opening of this email", not a random product shot from the middle.
 *
 * GIFs only win when no static image qualifies: an animated crop next to
 * calm digest copy is distracting, but it beats no preview at all.
 * Images with unknown sizes are skipped — an unmeasured asset is more
 * likely a logo than a hero, and a wrong preview is worse than none.
 */
export function chooseHeroImagePath(
  paths: string[],
  sizesByPath: Record<string, number>
): string | null {
  let firstGif: string | null = null;
  for (const path of paths) {
    if (!isTransformablePath(path)) continue;
    const size = sizesByPath[path];
    if (size === undefined || size < MIN_HERO_BYTES) continue;
    if (path.toLowerCase().endsWith(".gif")) {
      firstGif ??= path;
      continue;
    }
    return path;
  }
  return firstGif;
}

/**
 * Preview URLs for a batch of captured emails, keyed by email id, using
 * the given crop (defaults to the small square thumb). Emails without a
 * usable preview are absent from the map. Never throws — previews must
 * not be able to fail a notification send.
 *
 * Byte sizes come from `metadata.image_stats` when the row has been
 * measured (written at ingest / backfilled), falling back to the
 * `email_asset_sizes` RPC for the rest.
 */
export async function fetchEmailThumbnails(
  admin: SupabaseAdmin,
  emailIds: string[],
  transform: ImageTransform = EMAIL_PREVIEW_THUMB_TRANSFORM
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = Array.from(new Set(emailIds));
  if (ids.length === 0) return out;

  try {
    const { data } = await admin
      .from("captured_emails")
      .select("id, image_urls, metadata")
      .in("id", ids);

    const pathsByEmail = new Map<string, string[]>();
    const sizesByPath: Record<string, number> = {};
    const unmeasuredPaths = new Set<string>();
    for (const row of data ?? []) {
      const paths = Array.isArray(row.image_urls) ? row.image_urls : [];
      if (paths.length === 0) continue;
      pathsByEmail.set(row.id, paths);
      const stats = parseImageStats(row.metadata);
      if (stats) {
        for (const asset of stats.assets) sizesByPath[asset.path] = asset.bytes;
      } else {
        for (const path of paths) unmeasuredPaths.add(path);
      }
    }
    if (pathsByEmail.size === 0) return out;

    if (unmeasuredPaths.size > 0) {
      const fetched = await fetchEmailAssetSizes(
        admin,
        Array.from(unmeasuredPaths)
      );
      if (fetched) Object.assign(sizesByPath, fetched);
    }

    const heroByEmail = new Map<string, string>();
    for (const [emailId, paths] of pathsByEmail) {
      const hero = chooseHeroImagePath(paths, sizesByPath);
      if (hero) heroByEmail.set(emailId, hero);
    }
    if (heroByEmail.size === 0) return out;

    // No `sizesByPath` gate here on purpose: the transform is a fixed-
    // aspect CROP, not just a byte saving, so even a hero under the
    // resize threshold must go through it to fit the preview slot.
    const urls = await getSignedAssets(
      Array.from(new Set(heroByEmail.values())),
      { transform }
    );
    for (const [emailId, path] of heroByEmail) {
      const url = urls[path];
      if (url) out.set(emailId, url);
    }
  } catch (err) {
    console.error("email thumbnails: lookup failed", err);
  }
  return out;
}
