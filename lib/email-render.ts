/**
 * Helpers for turning a stored captured-email HTML payload into something safe
 * to render in the admin viewer. The main job is to swap out the original
 * remote `<img src>` (and a few related attributes) with short-lived signed
 * URLs that point at the assets we mirrored into Supabase Storage at ingest
 * time, so the preview looks like the email actually landed in an inbox.
 */

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const ATTR_RE = /(\s)(src|srcset|background|data-src|data-original|data-image|data-bg)\s*=\s*("([^"]*)"|'([^']*)')/gi;
const STYLE_TAG_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const STYLE_ATTR_RE = /(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/gi;
const URL_FN_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

export type RewriteOptions = {
  /** Map of original remote URL → mirrored Supabase Storage path. */
  mirrorMap: Record<string, string>;
  /** Map of mirrored storage path → short-lived signed URL. */
  signedAssets: Record<string, string>;
};

export type RewriteResult = {
  html: string;
  rewritten: number;
  total: number;
};

/**
 * Rewrites every image-bearing reference in the supplied HTML so that any
 * source we mirrored gets replaced with a signed Supabase Storage URL. URLs we
 * cannot resolve (because they were never mirrored or the signed URL is
 * missing) are left untouched so the original remote asset still has a chance
 * to load.
 */
export function rewriteEmailHtml(html: string, options: RewriteOptions): RewriteResult {
  if (!html) {
    return { html: "", rewritten: 0, total: 0 };
  }

  const lookup = buildLookup(options);

  let rewritten = 0;
  let total = 0;

  const resolve = (raw: string): string | null => {
    total += 1;
    const replacement = resolveUrl(raw, lookup);
    if (replacement) {
      rewritten += 1;
      return replacement;
    }
    return null;
  };

  const withRewrittenImgTags = html.replace(IMG_TAG_RE, (tag) => {
    return tag.replace(ATTR_RE, (_match, leading: string, attr: string, _value, dq: string | undefined, sq: string | undefined) => {
      const original = dq ?? sq ?? "";
      const lowerAttr = attr.toLowerCase();
      if (lowerAttr === "srcset") {
        const next = rewriteSrcset(original, lookup, () => {
          rewritten += 1;
        }, () => {
          total += 1;
        });
        return `${leading}${attr}="${escapeAttr(next)}"`;
      }
      const replacement = resolve(original);
      if (replacement) {
        return `${leading}${attr}="${escapeAttr(replacement)}"`;
      }
      return `${leading}${attr}="${escapeAttr(original)}"`;
    });
  });

  const withRewrittenStyles = withRewrittenImgTags
    .replace(STYLE_TAG_RE, (match, css: string) => {
      const next = rewriteCssUrls(css, lookup, () => {
        rewritten += 1;
      }, () => {
        total += 1;
      });
      return match.replace(css, next);
    })
    .replace(STYLE_ATTR_RE, (_match, prefix: string, _value, dq: string | undefined, sq: string | undefined) => {
      const original = dq ?? sq ?? "";
      const next = rewriteCssUrls(original, lookup, () => {
        rewritten += 1;
      }, () => {
        total += 1;
      });
      return `${prefix}"${escapeAttr(next)}"`;
    });

  return {
    html: withRewrittenStyles,
    rewritten,
    total
  };
}

type Lookup = {
  byRemote: Map<string, string>;
  byBasename: Map<string, string>;
};

function buildLookup(options: RewriteOptions): Lookup {
  const byRemote = new Map<string, string>();
  const byBasename = new Map<string, string>();

  for (const [remoteUrl, storagePath] of Object.entries(options.mirrorMap ?? {})) {
    const signed = options.signedAssets[storagePath];
    if (!signed) continue;

    const normalizedRemote = normalizeUrl(remoteUrl);
    if (normalizedRemote) {
      byRemote.set(normalizedRemote, signed);
    }

    const basename = extractBasename(remoteUrl);
    if (basename && !byBasename.has(basename)) {
      byBasename.set(basename, signed);
    }
  }

  return { byRemote, byBasename };
}

function resolveUrl(raw: string, lookup: Lookup): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:") || trimmed.startsWith("cid:")) return null;

  const normalized = normalizeUrl(trimmed);
  if (normalized && lookup.byRemote.has(normalized)) {
    return lookup.byRemote.get(normalized)!;
  }

  const basename = extractBasename(trimmed);
  if (basename && lookup.byBasename.has(basename)) {
    return lookup.byBasename.get(basename)!;
  }

  return null;
}

function rewriteSrcset(
  value: string,
  lookup: Lookup,
  onRewrite: () => void,
  onCount: () => void
): string {
  // srcset entries are comma-separated `url descriptor` pairs.
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  const next = entries.map((entry) => {
    const parts = entry.split(/\s+/);
    const url = parts[0] ?? "";
    const descriptor = parts.slice(1).join(" ");
    onCount();
    const replacement = resolveUrl(url, lookup);
    if (replacement) {
      onRewrite();
      return descriptor ? `${replacement} ${descriptor}` : replacement;
    }
    return entry;
  });
  return next.join(", ");
}

function rewriteCssUrls(
  css: string,
  lookup: Lookup,
  onRewrite: () => void,
  onCount: () => void
): string {
  return css.replace(URL_FN_RE, (match, quote: string, url: string) => {
    onCount();
    const replacement = resolveUrl(url, lookup);
    if (replacement) {
      onRewrite();
      const q = quote || '"';
      return `url(${q}${replacement}${q})`;
    }
    return match;
  });
}

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function extractBasename(value: string): string | null {
  if (!value) return null;
  let pathname = value;
  try {
    pathname = new URL(value).pathname;
  } catch {
    // Not a fully-qualified URL; fall back to the raw value.
  }
  const cleaned = pathname.split("?")[0]?.split("#")[0] ?? "";
  const lastSlash = cleaned.lastIndexOf("/");
  const basename = lastSlash >= 0 ? cleaned.slice(lastSlash + 1) : cleaned;
  return basename ? basename.toLowerCase() : null;
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;");
}
