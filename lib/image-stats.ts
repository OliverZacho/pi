/**
 * Per-email image weight and format stats.
 *
 * The shape lives in `captured_emails.metadata.image_stats` — written at
 * ingest from the mirrored assets (see `lib/ingest-processor.ts`), backfilled
 * for older rows from `storage.objects` sizes, and read back by the email
 * detail endpoint and the brand-page aggregation. Everything that touches the
 * shape goes through this module so the writers and readers can't drift.
 */

export type ImageFormat =
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "avif"
  | "svg"
  | "other";

export type EmailImageAsset = {
  /** Content-addressed storage path in the `email-assets` bucket. */
  path: string;
  bytes: number;
  format: ImageFormat;
};

export type EmailImageStats = {
  total_bytes: number;
  image_count: number;
  formats: Partial<Record<ImageFormat, { count: number; bytes: number }>>;
  /** Sorted by bytes descending — the modal lists heaviest first. */
  assets: EmailImageAsset[];
};

const IMAGE_FORMATS: ImageFormat[] = [
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
  "svg",
  "other"
];

const CONTENT_TYPE_FORMATS: Record<string, ImageFormat> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/pjpeg": "jpeg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg"
};

const EXTENSION_FORMATS: Record<string, ImageFormat> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  gif: "gif",
  webp: "webp",
  avif: "avif",
  svg: "svg"
};

export function formatFromContentType(
  contentType: string | null | undefined
): ImageFormat | null {
  if (!contentType) return null;
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return CONTENT_TYPE_FORMATS[normalized] ?? null;
}

/**
 * Format from the storage-path extension. Mirrored paths always carry a real
 * extension (`guessExtension` in lib/storage.ts), but the fallback branch of
 * that guesser copies whatever the remote URL ended with — `.bin`, `.app`
 * and friends exist in production, hence the `other` bucket.
 */
export function formatFromPath(path: string): ImageFormat {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  if (!match) return "other";
  return EXTENSION_FORMATS[match[1].toLowerCase()] ?? "other";
}

function aggregateAssets(assets: EmailImageAsset[]): EmailImageStats {
  const formats: EmailImageStats["formats"] = {};
  let totalBytes = 0;
  for (const asset of assets) {
    totalBytes += asset.bytes;
    const bucket = formats[asset.format] ?? { count: 0, bytes: 0 };
    bucket.count += 1;
    bucket.bytes += asset.bytes;
    formats[asset.format] = bucket;
  }
  return {
    total_bytes: totalBytes,
    image_count: assets.length,
    formats,
    assets: [...assets].sort((a, b) => b.bytes - a.bytes)
  };
}

/**
 * Stats from the mirror result at ingest time. Input is already deduped by
 * content hash (`mirrorRemoteImages`), so counts match `image_urls` semantics:
 * one entry per unique stored asset, not per `<img>` tag.
 */
export function buildImageStats(
  mirrored: { storagePath: string; contentType: string; byteLength: number }[]
): EmailImageStats {
  return aggregateAssets(
    mirrored.map((asset) => ({
      path: asset.storagePath,
      bytes: Math.max(0, Math.floor(asset.byteLength)),
      format:
        formatFromContentType(asset.contentType) ??
        formatFromPath(asset.storagePath)
    }))
  );
}

/**
 * Stats synthesized from `email_asset_sizes` RPC output — the live fallback
 * for rows the backfill hasn't touched. Paths missing from the size map are
 * skipped rather than counted as zero bytes.
 */
export function buildImageStatsFromSizes(
  paths: string[],
  sizesByPath: Record<string, number>
): EmailImageStats {
  const assets: EmailImageAsset[] = [];
  for (const path of paths) {
    const bytes = sizesByPath[path];
    if (typeof bytes !== "number" || !Number.isFinite(bytes)) continue;
    assets.push({
      path,
      bytes: Math.max(0, Math.floor(bytes)),
      format: formatFromPath(path)
    });
  }
  return aggregateAssets(assets);
}

/**
 * Defensive read of `metadata.image_stats` — same posture as
 * `parsePaletteColors` in lib/admin-db.ts: never trust the JSONB, drop
 * malformed entries, return `null` when the key is absent or unusable so
 * callers can distinguish "not measured" from "zero images".
 */
export function parseImageStats(metadata: unknown): EmailImageStats | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const candidate = (metadata as Record<string, unknown>).image_stats;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  const rawAssets = Array.isArray(record.assets) ? record.assets : [];
  const assets: EmailImageAsset[] = [];
  for (const item of rawAssets) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.path !== "string" || entry.path.length === 0) continue;
    const bytes =
      typeof entry.bytes === "number" && Number.isFinite(entry.bytes)
        ? Math.max(0, Math.floor(entry.bytes))
        : 0;
    const format =
      typeof entry.format === "string" &&
      (IMAGE_FORMATS as string[]).includes(entry.format)
        ? (entry.format as ImageFormat)
        : "other";
    assets.push({ path: entry.path, bytes, format });
  }
  // Recompute totals from the surviving assets instead of trusting the stored
  // rollup — keeps the invariant total = sum(assets) even if entries dropped.
  const stats = aggregateAssets(assets);
  if (stats.image_count === 0) {
    // A stored `{image_count: 0}` is a real measurement (email had no
    // mirrored images); an empty object or all-malformed assets is not.
    const storedCount =
      typeof record.image_count === "number" && Number.isFinite(record.image_count)
        ? record.image_count
        : null;
    return storedCount === 0 ? stats : null;
  }
  return stats;
}

/** Display label for a format: "JPEG", "PNG", …, "Other". */
export function imageFormatLabel(format: ImageFormat): string {
  return format === "other" ? "Other" : format.toUpperCase();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
