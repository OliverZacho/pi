import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "./supabase-admin";

export const EMAIL_HTML_BUCKET = "email-html";
export const EMAIL_ASSETS_BUCKET = "email-assets";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 60 * 60;

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

export async function uploadEmailHtml(emailId: string, html: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const path = `${emailId}.html`;
  const { error } = await supabase.storage
    .from(EMAIL_HTML_BUCKET)
    .upload(path, html, {
      contentType: "text/html; charset=utf-8",
      upsert: true,
      cacheControl: "private, max-age=0"
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
          cacheControl: "private, max-age=0"
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
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(EMAIL_HTML_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    return null;
  }

  return data.signedUrl;
}

export async function getSignedAssets(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) {
    return {};
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(EMAIL_ASSETS_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    return {};
  }

  const map: Record<string, string> = {};
  for (const item of data) {
    if (item.path && item.signedUrl) {
      map[item.path] = item.signedUrl;
    }
  }
  return map;
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
