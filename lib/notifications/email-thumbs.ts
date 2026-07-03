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
 * that reads as the email's hero, a failed lookup — simply yields no
 * entry and the row renders text-only, exactly as before.
 */

/**
 * Assets below this size are never preview candidates. Brand logos,
 * icons, and tracking spacers cluster well under it, while the image an
 * email actually opens with is almost always bigger.
 */
const MIN_HERO_BYTES = 15 * 1024;

/**
 * The confident tier: an image this heavy is essentially always a real
 * hero/editorial shot. Big monogram-logo header images (flat color on
 * white, common in fashion emails) can clear {@link MIN_HERO_BYTES} but
 * compress far below this line.
 */
const STRONG_HERO_BYTES = 60 * 1024;

/**
 * Flat-graphic filter, in bytes per pixel, per format — the scales
 * differ by an order of magnitude. Measured on production assets:
 *
 *   PNG:  photography compresses to 1.5+, while logo wordmarks and
 *         line-drawing decorations land at 0.006–0.112. The 0.25 line
 *         sits well clear of both sides.
 *   JPEG (and other lossy formats): photography lands at 0.13–0.3;
 *         a flat graphic saved as JPEG compresses under 0.05.
 *
 * Anything under its format's line crops into a near-empty banner, so
 * it's skipped in favor of the next candidate.
 */
const MIN_HERO_DENSITY: Record<ProbedFormat, number> = {
  png: 0.25,
  jpeg: 0.05,
  gif: 0.05,
  webp: 0.05
};

/** Candidates probed per email before giving up on a preview. */
const MAX_PROBES_PER_EMAIL = 3;

/** Bytes fetched per probe — plenty for every dimension header we parse. */
const PROBE_BYTES = 64 * 1024;

/**
 * Preview candidates for one email, best first, over `image_urls` (which
 * preserves the order the assets appear in the email body):
 *
 *  1. Static images ≥ {@link STRONG_HERO_BYTES} in document order — the
 *     email's visible top. Cropped from its top edge it reads as "the
 *     opening of this email", not a random product shot from the middle.
 *  2. Static images ≥ {@link MIN_HERO_BYTES} by size, largest first —
 *     for modest emails with no heavyweight image, biggest wins over
 *     first-in-order because at these sizes "first" is as likely a logo
 *     as a hero.
 *  3. GIFs ≥ {@link MIN_HERO_BYTES}, largest first: an animated crop
 *     next to calm digest copy is distracting, but it beats no preview.
 *
 * Images with unknown sizes are skipped — an unmeasured asset is more
 * likely a logo than a hero, and a wrong preview is worse than none.
 */
export function heroImageCandidates(
  paths: string[],
  sizesByPath: Record<string, number>
): string[] {
  const strong: string[] = [];
  const modest: { path: string; size: number }[] = [];
  const gifs: { path: string; size: number }[] = [];
  for (const path of paths) {
    if (!isTransformablePath(path)) continue;
    const size = sizesByPath[path];
    if (size === undefined || size < MIN_HERO_BYTES) continue;
    if (path.toLowerCase().endsWith(".gif")) {
      gifs.push({ path, size });
      continue;
    }
    if (size >= STRONG_HERO_BYTES) {
      strong.push(path);
      continue;
    }
    modest.push({ path, size });
  }
  modest.sort((a, b) => b.size - a.size);
  gifs.sort((a, b) => b.size - a.size);
  return [
    ...strong,
    ...modest.map((entry) => entry.path),
    ...gifs.map((entry) => entry.path)
  ];
}

export type ProbedFormat = "png" | "jpeg" | "gif" | "webp";

export type ImageDimensions = {
  width: number;
  height: number;
  format: ProbedFormat;
};

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

/**
 * Pixel dimensions from the leading bytes of a PNG / JPEG / GIF / WebP
 * stream. Returns null for anything it can't parse confidently (other
 * formats, truncated headers) — callers treat null as "unknown", never
 * as a failure.
 */
export function parseImageDimensions(
  bytes: Uint8Array
): ImageDimensions | null {
  if (bytes.length < 26) return null;

  // PNG: 8-byte signature, then the IHDR chunk with width/height first.
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const width = u32be(bytes, 16);
    const height = u32be(bytes, 20);
    return width > 0 && height > 0
      ? { width, height, format: "png" }
      : null;
  }

  // GIF87a / GIF89a: logical screen size right after the 6-byte header.
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    const width = u16le(bytes, 6);
    const height = u16le(bytes, 8);
    return width > 0 && height > 0
      ? { width, height, format: "gif" }
      : null;
  }

  // JPEG: walk the marker stream to the first SOFn frame header.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1];
      // Standalone markers (no length payload).
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isSof) {
        const height = u16be(bytes, i + 5);
        const width = u16be(bytes, i + 7);
        return width > 0 && height > 0
          ? { width, height, format: "jpeg" }
          : null;
      }
      i += 2 + u16be(bytes, i + 2);
    }
    return null;
  }

  // WebP: RIFF container, dimensions depend on the first chunk type.
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === "VP8X" && bytes.length >= 30) {
      return {
        width: u24le(bytes, 24) + 1,
        height: u24le(bytes, 27) + 1,
        format: "webp"
      };
    }
    if (chunk === "VP8 " && bytes.length >= 30) {
      const width = u16le(bytes, 26) & 0x3fff;
      const height = u16le(bytes, 28) & 0x3fff;
      return width > 0 && height > 0
        ? { width, height, format: "webp" }
        : null;
    }
    if (chunk === "VP8L" && bytes.length >= 25) {
      // VP8L packs 14-bit width-1 / height-1 little-endian after the
      // 0x2f signature byte.
      const raw =
        bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      const width = (raw & 0x3fff) + 1;
      const height = ((raw >> 14) & 0x3fff) + 1;
      return { width, height, format: "webp" };
    }
    return null;
  }

  return null;
}

/**
 * Whether a candidate's byte size is plausible for photographic content
 * at its pixel dimensions. Unknown dimensions pass — over-rejecting
 * loses good previews, and the byte tiers already filtered the obvious
 * junk.
 */
export function passesDensity(
  bytes: number,
  dims: ImageDimensions | null
): boolean {
  if (!dims) return true;
  const pixels = dims.width * dims.height;
  if (pixels <= 0) return true;
  return bytes / pixels >= MIN_HERO_DENSITY[dims.format];
}

/**
 * Probe verdicts, cached per storage path for the process lifetime.
 * Paths are content-addressed (SHA-1), so a verdict never goes stale,
 * and one cron run fans the same picks out to many users.
 */
const probeVerdicts = new Map<string, boolean>();

/** Fetch up to {@link PROBE_BYTES} of an asset without trusting Range. */
async function fetchLeadingBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${PROBE_BYTES - 1}` }
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < PROBE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    await reader.cancel().catch(() => undefined);
    const out = new Uint8Array(Math.min(total, PROBE_BYTES));
    let offset = 0;
    for (const chunk of chunks) {
      const take = Math.min(chunk.byteLength, out.length - offset);
      out.set(chunk.subarray(0, take), offset);
      offset += take;
      if (offset >= out.length) break;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Preview URLs for a batch of captured emails, keyed by email id, using
 * the given crop (defaults to the small square thumb). Emails without a
 * usable preview are absent from the map. Never throws — previews must
 * not be able to fail a notification send.
 *
 * Byte sizes come from `metadata.image_stats` when the row has been
 * measured (written at ingest / backfilled), falling back to the
 * `email_asset_sizes` RPC for the rest. The top candidates are then
 * probed (a few KB each) for pixel dimensions so flat graphics —
 * oversized logo banners, line-drawing decorations — fall through to
 * the next candidate instead of becoming a near-empty preview.
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

    const candidatesByEmail = new Map<string, string[]>();
    for (const [emailId, paths] of pathsByEmail) {
      const candidates = heroImageCandidates(paths, sizesByPath).slice(
        0,
        MAX_PROBES_PER_EMAIL
      );
      if (candidates.length > 0) candidatesByEmail.set(emailId, candidates);
    }
    if (candidatesByEmail.size === 0) return out;

    // Plain (untransformed) URLs for probing the original headers.
    const probeUrls = await getSignedAssets(
      Array.from(new Set([...candidatesByEmail.values()].flat()))
    );

    const heroByEmail = new Map<string, string>();
    for (const [emailId, candidates] of candidatesByEmail) {
      for (const path of candidates) {
        let verdict = probeVerdicts.get(path);
        if (verdict === undefined) {
          const url = probeUrls[path];
          const head = url ? await fetchLeadingBytes(url) : null;
          verdict = passesDensity(
            sizesByPath[path] ?? 0,
            head ? parseImageDimensions(head) : null
          );
          probeVerdicts.set(path, verdict);
        }
        if (verdict) {
          heroByEmail.set(emailId, path);
          break;
        }
      }
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
