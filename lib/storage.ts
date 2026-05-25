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
 * `public, max-age=31536000, immutable` `cacheControl` we set at upload
 * time, this means a card image only crosses the Storage Egress meter
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

const EMAIL_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

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
  emailId: string,
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
      const storagePath = `${emailId}/${digest}${extension}`;

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

  // ⚠️ Image transformations are DISABLED at the storage layer.
  //
  // Supabase Storage's image transformation pipeline (imgproxy) is
  // metered per unique `(path, transform)` pair. The current plan
  // includes 100 transformations/month and we blew past 500% of that
  // by minting transformed URLs for every brand logo on the Explore
  // / Collections / Compare grids (one per unique logo, forever).
  //
  // Until we either (a) upgrade to a usage-based plan, (b) move
  // resizing to a CDN/Vercel image loader, or (c) pre-bake thumbnails
  // at capture time, force every caller through the plain
  // `object/sign` path even when they pass `transform: ...`. The
  // option still type-checks so the existing call sites compile —
  // it's just a no-op. To re-enable: delete this override and the
  // surrounding comment block, and audit which call sites really
  // need a transform vs. a one-time pre-baked thumbnail.
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
