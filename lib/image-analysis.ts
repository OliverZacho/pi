import sharp from "sharp";
import { EMAIL_ASSETS_BUCKET } from "./storage";
import { getSupabaseAdmin } from "./supabase-admin";

/**
 * Per-channel standard deviation (0–255) at or below which a channel is
 * treated as effectively constant — i.e. the channel carries no detail.
 */
const UNIFORM_STDEV = 4;

/**
 * Alpha-channel mean (0–255) at or below which an image is treated as
 * (almost) fully transparent — nothing is actually painted.
 */
const TRANSPARENT_MEAN = 4;

/**
 * Heuristic "is this image visually blank?". Returns `true` for the two
 * shapes that routinely out-rank a real logo in the frequency picker because
 * brands embed them in every email:
 *
 *   - fully (or near-fully) transparent spacers, and
 *   - solid single-colour blocks (white spacers, background fills).
 *
 * A real wordmark is *not* blank: on an opaque canvas its colour channels
 * vary, and on a transparent canvas its shape lives in a varying alpha
 * channel. Both cases are preserved below.
 *
 * Anything we can't decode (SVG quirks, corrupt bytes, unsupported formats)
 * returns `false` — "keep it" — so a decode failure can never hide a brand's
 * actual logo.
 */
export async function isImageBlank(
  bytes: Buffer | Uint8Array
): Promise<boolean> {
  try {
    const stats = await sharp(bytes).stats();
    const channels = stats.channels;
    if (channels.length === 0) {
      return false;
    }

    // `isOpaque` is true when there is no alpha channel, or the alpha channel
    // is 255 everywhere. So a non-opaque image always has a meaningful alpha
    // channel, which sharp orders last.
    const hasAlpha = !stats.isOpaque && channels.length >= 2;
    const colourChannels = hasAlpha ? channels.slice(0, -1) : channels;
    const alpha = hasAlpha ? channels[channels.length - 1] : null;

    // Almost nothing is painted: a transparent spacer.
    if (
      alpha &&
      alpha.mean <= TRANSPARENT_MEAN &&
      alpha.stdev <= UNIFORM_STDEV
    ) {
      return true;
    }

    // Every visible colour channel is flat → a single uniform colour.
    const colourIsFlat = colourChannels.every((c) => c.stdev <= UNIFORM_STDEV);
    if (colourIsFlat) {
      // A flat colour over a *varying* alpha mask is a monochrome wordmark —
      // its whole shape is in the alpha channel — so it's not blank.
      if (alpha && alpha.stdev > UNIFORM_STDEV) {
        return false;
      }
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Per-process memo of blankness keyed by storage path. Paths in
 * `email-assets` are content-addressed by SHA-1 (see `mirrorRemoteImages`),
 * so the bytes behind a path never change and the result is safe to cache for
 * the life of the process.
 */
const blankByStoragePath = new Map<string, boolean>();

/**
 * Downloads a mirrored asset and reports whether it is visually blank
 * (see {@link isImageBlank}). Network/storage failures resolve to `false`
 * ("keep it") so a transient error never demotes a real logo. Results are
 * memoised per path.
 */
export async function isStoredImageBlank(storagePath: string): Promise<boolean> {
  const cached = blankByStoragePath.get(storagePath);
  if (cached !== undefined) {
    return cached;
  }

  let blank = false;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from(EMAIL_ASSETS_BUCKET)
      .download(storagePath);
    if (!error && data) {
      const bytes = Buffer.from(await data.arrayBuffer());
      blank = await isImageBlank(bytes);
    }
  } catch {
    blank = false;
  }

  blankByStoragePath.set(storagePath, blank);
  return blank;
}

/**
 * Test-only escape hatch to clear the per-path blankness memo so cases that
 * reuse storage paths stay isolated.
 */
export function __resetBlankImageCacheForTests(): void {
  blankByStoragePath.clear();
}
