import {
  EMAIL_THUMB_TRANSFORM,
  getSignedAssets,
  isTransformablePath
} from "@/lib/storage";
import { fetchEmailAssetSizes } from "@/lib/admin-db";
import type { SupabaseAdmin } from "./shared";

/**
 * Resolves one small "hero image" preview URL per captured email, for
 * embedding next to that email's row in a notification (digest picks,
 * smart-collection samples). Best effort by design: any miss — no stored
 * images, no image big enough to be a hero, a failed lookup — simply
 * yields no entry and the row renders text-only, exactly as before.
 */

/**
 * Assets below this size are never picked as the hero. Brand logos,
 * icons, and tracking spacers cluster well under it, while product and
 * banner shots are almost always bigger — without this floor a text-only
 * email would get its logo stretched into a "preview".
 */
const MIN_HERO_BYTES = 15 * 1024;

/**
 * The hero heuristic: the largest transformable image in the email body
 * that clears {@link MIN_HERO_BYTES}. When byte sizes are unavailable
 * (the sizes RPC failed) fall back to the first transformable image —
 * document order puts it near the top of the email — rather than showing
 * nothing.
 */
export function chooseHeroImagePath(
  paths: string[],
  sizesByPath: Record<string, number> | undefined
): string | null {
  const candidates = paths.filter(isTransformablePath);
  if (candidates.length === 0) return null;
  if (!sizesByPath) return candidates[0];
  let best: string | null = null;
  let bestSize = 0;
  for (const path of candidates) {
    const size = sizesByPath[path];
    if (size === undefined || size < MIN_HERO_BYTES) continue;
    if (size > bestSize) {
      best = path;
      bestSize = size;
    }
  }
  return best;
}

/**
 * Hero preview URLs for a batch of captured emails, keyed by email id.
 * Emails without a usable hero are absent from the map. Never throws —
 * thumbnails must not be able to fail a notification send.
 */
export async function fetchEmailThumbnails(
  admin: SupabaseAdmin,
  emailIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = Array.from(new Set(emailIds));
  if (ids.length === 0) return out;

  try {
    const { data } = await admin
      .from("captured_emails")
      .select("id, image_urls")
      .in("id", ids);

    const pathsByEmail = new Map<string, string[]>();
    const allPaths = new Set<string>();
    for (const row of data ?? []) {
      const paths = Array.isArray(row.image_urls) ? row.image_urls : [];
      if (paths.length === 0) continue;
      pathsByEmail.set(row.id, paths);
      for (const path of paths) allPaths.add(path);
    }
    if (allPaths.size === 0) return out;

    const sizes = await fetchEmailAssetSizes(admin, Array.from(allPaths));

    const heroByEmail = new Map<string, string>();
    for (const [emailId, paths] of pathsByEmail) {
      const hero = chooseHeroImagePath(paths, sizes);
      if (hero) heroByEmail.set(emailId, hero);
    }
    if (heroByEmail.size === 0) return out;

    // No `sizesByPath` gate here on purpose: the transform is a cover
    // CROP, not just a byte saving, so even a hero under the resize
    // threshold must go through it to fit the fixed thumbnail slot.
    const urls = await getSignedAssets(
      Array.from(new Set(heroByEmail.values())),
      { transform: EMAIL_THUMB_TRANSFORM }
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
