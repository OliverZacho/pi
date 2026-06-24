import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "./supabase-admin";

export const EMAIL_HTML_BUCKET = "email-html";
export const EMAIL_ASSETS_BUCKET = "email-assets";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Signed URLs live for 7 days. Bumped up from 1 hour so the same URL is
 * reused across many page views, which lets the browser cache and Supabase
 * Storage's CDN edge layer actually do their job. Combined with the
 * `public, max-age=31536000, immutable` cache-control we set at upload
 * time (see {@link EMAIL_ASSET_CACHE_CONTROL}), this means a card image
 * only crosses the Storage Egress meter
 * once per (URL, viewer) tuple inside the 7-day window.
 *
 * Storage paths are content-addressed by SHA-1 (`mirrorRemoteImages`), so
 * leaking one signed URL never reveals more than the bytes of that one
 * asset, and the URL itself stops working after the TTL.
 */
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Re-sign a cached signed URL once we're inside this window of its
 * expiry. The point is to avoid handing a viewer a URL that expires in
 * the middle of their session — the renderer pulls fresh URLs whenever
 * the buffer kicks in, and the next caller benefits from the new TTL.
 */
const SIGNED_URL_REFRESH_BUFFER_MS = 24 * 60 * 60 * 1000;

/**
 * Value passed to Supabase Storage's `upload({ cacheControl })`. Storage
 * does NOT take a full header here — it substitutes this into
 * `public, max-age=<value>` itself. So we pass only the seconds plus the
 * `immutable` directive and let Storage prepend `public, max-age=`,
 * yielding `public, max-age=31536000, immutable`.
 *
 * (Previously this was the *entire* header string, which Storage then
 * double-stamped into the invalid `public, max-age=public, max-age=...`
 * — that broke the `max-age` parse so browsers revalidated far more often
 * than the intended year. Only assets uploaded after this fix get the
 * corrected header.)
 */
const EMAIL_ASSET_CACHE_CONTROL = "31536000, immutable";

/**
 * Public-CDN base URL for the `email-assets` bucket. When set, every
 * caller of `getSignedAssets` gets back a `https://<cdn>/storage/v1/
 * object/public/email-assets/<path>` URL instead of a signed URL,
 * which means:
 *
 *   - No Supabase round-trip to mint signatures (createSignedUrls is
 *     skipped entirely).
 *   - Cloudflare's edge cache can dedupe across viewers (signed URLs
 *     can't — their per-request token varies the cache key).
 *   - The signed-URL in-process memoisation cache stops being a
 *     bottleneck for cold instances.
 *
 * Safe because `email-assets` paths are content-addressed by SHA-1
 * (see `mirrorRemoteImages`) so they're unguessable in practice, and
 * the bucket is configured `public = true` server-side.
 *
 * Unset locally (no `.env.local` entry) → falls back to the signed
 * URL path so dev against a private bucket / local Supabase keeps
 * working unchanged.
 *
 * `email-html` is *not* affected by this — `getSignedHtml` always
 * mints a signed URL because that bucket stays private.
 */
const PUBLIC_ASSET_CDN_BASE_URL =
  process.env.NEXT_PUBLIC_ASSET_CDN_URL?.replace(/\/+$/, "") || null;

/**
 * Master switch for Cloudflare Image Resizing on the CDN path. OFF by
 * default so this code is safe to deploy *before* the feature is enabled
 * on the `cdn.pirol.app` Cloudflare zone — while off we emit plain public
 * URLs (full-size originals, same as before). The `/cdn-cgi/image/...`
 * path 404s on a zone where resizing isn't enabled, so flipping this on
 * before the dashboard toggle would break every resized image.
 *
 * Rollout order: (1) enable Image Resizing in the Cloudflare dashboard,
 * (2) set `CF_IMAGE_RESIZE=1` in the env, (3) redeploy. Flip the env back
 * to roll resizing off instantly without a code change.
 */
const CF_IMAGE_RESIZE_ENABLED = process.env.CF_IMAGE_RESIZE === "1";

function publicAssetUrl(path: string): string {
  return `${PUBLIC_ASSET_CDN_BASE_URL}/storage/v1/object/public/${EMAIL_ASSETS_BUCKET}/${path}`;
}

/**
 * Resized variant of {@link publicAssetUrl} via Cloudflare Image
 * Resizing (the `/cdn-cgi/image/<options>/<path>` URL form). This runs
 * on the `cdn.pirol.app` zone, NOT Supabase's metered transform pipeline,
 * so it sidesteps the transform quota entirely (see the note in
 * {@link getSignedAssets}). Only meaningful when the CDN is configured.
 *
 *   - `fit=scale-down` never upscales, so an image already smaller than
 *     the requested width is served untouched (no quality loss).
 *   - `format=auto` serves WebP/AVIF to browsers that accept it — the
 *     bulk of the byte savings on top of the resize.
 *
 * Billing note: Cloudflare counts one transformation per unique
 * `(source image, options)` pair per month, then serves cached variants
 * free. So cost tracks unique images *viewed* per month, not requests.
 */
function cloudflareImageUrl(path: string, transform: ImageTransform): string {
  const opts = [`width=${transform.width}`, "fit=scale-down", "format=auto"];
  if (transform.height) opts.push(`height=${transform.height}`);
  if (transform.quality) opts.push(`quality=${transform.quality}`);
  return `${PUBLIC_ASSET_CDN_BASE_URL}/cdn-cgi/image/${opts.join(
    ","
  )}/storage/v1/object/public/${EMAIL_ASSETS_BUCKET}/${path}`;
}

export type ImageTransform = {
  width: number;
  height?: number;
  quality?: number;
};

/**
 * Default Supabase Storage transform for brand-logo avatars. The logo
 * almost always renders at <= 64 CSS pixels (16-32 px in card headers,
 * 24-48 px in the modal), so a 128-px wide variant covers HiDPI
 * displays at 2x without shipping the original (often 512 px+) asset
 * across the egress meter.
 */
export const BRAND_LOGO_TRANSFORM: ImageTransform = {
  width: 128,
  quality: 75
};

/**
 * Transform used by the Explore / Brand / Collection card iframes when
 * they re-sign every mirrored image in the email body. Cards visually
 * occupy ~250-300 CSS px wide; 600 px wide keeps the design crisp at
 * 2x without shipping multi-MB hero images. The modal opts out of this
 * transform and gets full-fidelity URLs.
 */
export const CARD_IMAGE_TRANSFORM: ImageTransform = {
  width: 600,
  quality: 70
};

export type MirroredImage = {
  remoteUrl: string;
  storagePath: string;
  contentType: string;
  byteLength: number;
};

export type MirrorResult = {
  storedPaths: string[];
  stored: MirroredImage[];
  failedUrls: { url: string; reason: string }[];
};

type SignedUrlCacheEntry = {
  url: string;
  expiresAt: number;
};

/**
 * Per-process memoisation of signed URLs, keyed by `(bucket, path,
 * transform)`. The key includes the transform so card-grid thumbnails
 * and full-fidelity modal URLs cache independently. Entries are evicted
 * lazily on read once they enter the refresh buffer.
 *
 * Cold starts repopulate naturally — the win is dedup inside a warm
 * instance, which is where the per-page-view fan-out lives.
 */
const signedUrlCache = new Map<string, SignedUrlCacheEntry>();

function signedUrlCacheKey(
  bucket: string,
  path: string,
  transform?: ImageTransform
): string {
  if (!transform) return `${bucket}|${path}`;
  const h = transform.height ?? "";
  const q = transform.quality ?? "";
  return `${bucket}|${path}|w=${transform.width}|h=${h}|q=${q}`;
}

function readCachedSignedUrl(key: string): string | null {
  const entry = signedUrlCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt - SIGNED_URL_REFRESH_BUFFER_MS <= Date.now()) {
    signedUrlCache.delete(key);
    return null;
  }
  return entry.url;
}

function writeCachedSignedUrl(key: string, url: string): void {
  signedUrlCache.set(key, {
    url,
    expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000
  });
}

/**
 * Test-only escape hatch — clears the in-process signed-URL cache so
 * test cases that re-use storage paths can isolate behaviour from each
 * other. Not exported via the public surface; tests reach in via
 * `import { __resetSignedUrlCacheForTests } from "@/lib/storage"`.
 */
export function __resetSignedUrlCacheForTests(): void {
  signedUrlCache.clear();
}

export async function uploadEmailHtml(emailId: string, html: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const path = `${emailId}.html`;
  const { error } = await supabase.storage
    .from(EMAIL_HTML_BUCKET)
    .upload(path, html, {
      contentType: "text/html; charset=utf-8",
      upsert: true,
      cacheControl: EMAIL_ASSET_CACHE_CONTROL
    });

  if (error) {
    throw new Error(`Failed to upload email HTML to storage: ${error.message}`);
  }

  return path;
}

export async function mirrorRemoteImages(
  urls: string[]
): Promise<MirrorResult> {
  const supabase = getSupabaseAdmin();
  const seenPaths = new Set<string>();
  const stored: MirroredImage[] = [];
  const failedUrls: { url: string; reason: string }[] = [];
  const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));

  for (const url of uniqueUrls) {
    try {
      const fetched = await fetchImage(url);
      const extension = guessExtension(fetched.contentType, url);
      const digest = createHash("sha1").update(fetched.bytes).digest("hex");
      // Storage paths are content-addressed by SHA-1 alone — the
      // same image content embedded in any email costs exactly one
      // storage object, and `upsert: true` makes a re-mirror a
      // no-op at the bytes level. See git history for the migration
      // that flipped this from the historical
      // `${emailId}/${sha1}${ext}` layout.
      const storagePath = `${digest}${extension}`;

      if (seenPaths.has(storagePath)) {
        continue;
      }
      seenPaths.add(storagePath);

      const { error } = await supabase.storage
        .from(EMAIL_ASSETS_BUCKET)
        .upload(storagePath, fetched.bytes, {
          contentType: fetched.contentType,
          upsert: true,
          cacheControl: EMAIL_ASSET_CACHE_CONTROL
        });

      if (error) {
        failedUrls.push({ url, reason: `upload failed: ${error.message}` });
        continue;
      }

      stored.push({
        remoteUrl: url,
        storagePath,
        contentType: fetched.contentType,
        byteLength: fetched.bytes.byteLength
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      failedUrls.push({ url, reason });
    }
  }

  return {
    storedPaths: stored.map((item) => item.storagePath),
    stored,
    failedUrls
  };
}

export async function getSignedHtml(path: string): Promise<string | null> {
  const key = signedUrlCacheKey(EMAIL_HTML_BUCKET, path);
  const cached = readCachedSignedUrl(key);
  if (cached) return cached;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(EMAIL_HTML_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    return null;
  }

  writeCachedSignedUrl(key, data.signedUrl);
  return data.signedUrl;
}

export type GetSignedAssetsOptions = {
  /**
   * Optional Supabase Storage image transformation to apply to every
   * URL in the batch. When set, the returned URLs point at the
   * `/render/image/sign/...` endpoint and the storage layer resizes /
   * re-encodes the asset on the fly. Pro plan or higher.
   *
   * Vector and icon formats that the transformation layer can't
   * process (SVG, ICO) are detected by extension and fall back to a
   * regular `object/sign` URL automatically, so the caller doesn't
   * have to filter the path list itself. Without that fallback the
   * image request 4xx's and the surrounding email layout collapses
   * around the broken `<img>`.
   */
  transform?: ImageTransform;
};

/**
 * File extensions that Supabase Storage's image transformation pipeline
 * (imgproxy under the hood) does not support. Anything in this set is
 * signed without a transform even when the caller asks for one.
 *
 * The transformation layer supports PNG, JPEG, WebP, AVIF, GIF, and
 * HEIC. Anything else — most importantly SVG logos, which a lot of
 * brands ship — has to be served straight from storage.
 */
const NON_TRANSFORMABLE_EXTENSIONS = new Set([".svg", ".ico", ".bin"]);

function isTransformablePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return true;
  const ext = path.slice(dot).toLowerCase();
  return !NON_TRANSFORMABLE_EXTENSIONS.has(ext);
}

export async function getSignedAssets(
  paths: string[],
  options: GetSignedAssetsOptions = {}
): Promise<Record<string, string>> {
  if (paths.length === 0) {
    return {};
  }

  // Public-CDN short-circuit. When `NEXT_PUBLIC_ASSET_CDN_URL` is set the
  // `email-assets` bucket is served as a public bucket behind Cloudflare,
  // so we skip `createSignedUrls` entirely and hand back deterministic
  // public URLs (O(n) string concat, no Supabase round-trip, no signing
  // TTFB, and the edge can dedupe across viewers).
  //
  // Resizing happens HERE via Cloudflare Image Resizing (the
  // `/cdn-cgi/image/...` form) — NOT Supabase's metered transform
  // pipeline (see the note below). A raster path with a transform gets the
  // resized URL; everything else (no transform, or SVG/ICO) gets the plain
  // public URL.
  if (PUBLIC_ASSET_CDN_BASE_URL) {
    const out: Record<string, string> = {};
    const resize = CF_IMAGE_RESIZE_ENABLED;
    for (const path of paths) {
      out[path] =
        resize && options.transform && isTransformablePath(path)
          ? cloudflareImageUrl(path, options.transform)
          : publicAssetUrl(path);
    }
    return out;
  }

  // ⚠️ Supabase Storage's own transform pipeline (imgproxy) stays DISABLED.
  //
  // It's metered per unique `(path, transform)` pair and the plan only
  // includes 100/month, which we blew past 5x by minting transformed URLs
  // for every brand logo on the grids. Resizing now lives on the Cloudflare
  // CDN path above; this branch (local dev / no CDN) serves plain
  // `object/sign` URLs even when a transform is requested. The option still
  // type-checks so call sites compile — it's just a no-op without the CDN.
  const transform: ImageTransform | undefined = undefined;
  void options.transform;

  const result: Record<string, string> = {};

  // Split into "transformable" (PNG/JPEG/WebP/AVIF/GIF/HEIC) and
  // "non-transformable" (SVG/ICO/unknown). When `transform` is set we
  // only apply it to the first group; the second group falls back to
  // straight `object/sign` URLs. Each group has its own cache entry
  // (transform vs no-transform) so future cache hits stay correct.
  const transformablePaths: string[] = [];
  const passthroughPaths: string[] = [];
  for (const path of paths) {
    if (transform && !isTransformablePath(path)) {
      passthroughPaths.push(path);
    } else {
      transformablePaths.push(path);
    }
  }

  const transformableMissing: string[] = [];
  for (const path of transformablePaths) {
    const cached = readCachedSignedUrl(
      signedUrlCacheKey(EMAIL_ASSETS_BUCKET, path, transform)
    );
    if (cached) {
      result[path] = cached;
    } else if (!transformableMissing.includes(path)) {
      transformableMissing.push(path);
    }
  }

  const passthroughMissing: string[] = [];
  for (const path of passthroughPaths) {
    const cached = readCachedSignedUrl(
      signedUrlCacheKey(EMAIL_ASSETS_BUCKET, path)
    );
    if (cached) {
      result[path] = cached;
    } else if (!passthroughMissing.includes(path)) {
      passthroughMissing.push(path);
    }
  }

  if (transformableMissing.length === 0 && passthroughMissing.length === 0) {
    return result;
  }

  const supabase = getSupabaseAdmin();

  if (transformableMissing.length > 0) {
    if (transform) {
      // `createSignedUrls` (the batch endpoint) doesn't accept a
      // `transform` option — that path only exists on the singular
      // `createSignedUrl`. Fan out in parallel; the memoisation cache
      // means we only pay this cost on the first request for each
      // `(path, transform)` pair within the TTL window.
      const settled = await Promise.allSettled(
        transformableMissing.map((path) =>
          supabase.storage
            .from(EMAIL_ASSETS_BUCKET)
            .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { transform })
        )
      );

      settled.forEach((outcome, index) => {
        if (outcome.status !== "fulfilled") return;
        const { data, error } = outcome.value;
        if (error || !data?.signedUrl) return;
        const path = transformableMissing[index];
        result[path] = data.signedUrl;
        writeCachedSignedUrl(
          signedUrlCacheKey(EMAIL_ASSETS_BUCKET, path, transform),
          data.signedUrl
        );
      });
    } else {
      const { data, error } = await supabase.storage
        .from(EMAIL_ASSETS_BUCKET)
        .createSignedUrls(transformableMissing, SIGNED_URL_TTL_SECONDS);

      if (!error && data) {
        for (const item of data) {
          if (item.path && item.signedUrl) {
            result[item.path] = item.signedUrl;
            writeCachedSignedUrl(
              signedUrlCacheKey(EMAIL_ASSETS_BUCKET, item.path),
              item.signedUrl
            );
          }
        }
      }
    }
  }

  if (passthroughMissing.length > 0) {
    const { data, error } = await supabase.storage
      .from(EMAIL_ASSETS_BUCKET)
      .createSignedUrls(passthroughMissing, SIGNED_URL_TTL_SECONDS);

    if (!error && data) {
      for (const item of data) {
        if (item.path && item.signedUrl) {
          result[item.path] = item.signedUrl;
          writeCachedSignedUrl(
            signedUrlCacheKey(EMAIL_ASSETS_BUCKET, item.path),
            item.signedUrl
          );
        }
      }
    }
  }

  return result;
}

async function fetchImage(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow"
    });

    if (!response.ok) {
      throw new Error(`http ${response.status}`);
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const declared = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
        throw new Error(`image too large: ${declared} bytes`);
      }
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`image too large: ${buffer.byteLength} bytes`);
    }

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ||
      "application/octet-stream";

    return {
      bytes: new Uint8Array(buffer),
      contentType
    };
  } finally {
    clearTimeout(timer);
  }
}

function guessExtension(contentType: string, url: string): string {
  const fromContentType: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
    "image/x-icon": ".ico",
    "image/vnd.microsoft.icon": ".ico"
  };

  if (contentType in fromContentType) {
    return fromContentType[contentType];
  }

  try {
    const path = new URL(url).pathname;
    const dot = path.lastIndexOf(".");
    if (dot >= 0 && dot >= path.length - 6) {
      const ext = path.slice(dot).toLowerCase();
      if (/^\.[a-z0-9]{2,5}$/.test(ext)) {
        return ext;
      }
    }
  } catch {
    /* invalid URL - fall through */
  }

  return ".bin";
}
