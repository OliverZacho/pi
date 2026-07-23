/**
 * Helpers for turning a stored captured-email HTML payload into something safe
 * to render in the admin viewer. The main job is to swap out the original
 * remote `<img src>` (and a few related attributes) with short-lived signed
 * URLs that point at the assets we mirrored into Supabase Storage at ingest
 * time, so the preview looks like the email actually landed in an inbox.
 */

/**
 * Content-Security-Policy for the rendered email-preview document.
 *
 * Captured emails embed the sender's own remote resources — most notably
 * **open-tracking pixels** and unmirrored remote images. Letting the preview
 * iframe load them means (a) a slow third-party (e.g. an ESP tracker that
 * takes 8s to answer) hangs the whole page's load spinner, and (b) we phone
 * home to the brand's tracker on every view, leaking our capture address.
 *
 * This policy restricts the preview to images from our own mirrored assets
 * (the CDN, or the Supabase signed-URL host in dev) plus inline data: URIs,
 * and blocks everything else — scripts, remote stylesheets, remote fonts, and
 * crucially remote/tracking images. The real content images are all mirrored
 * to our CDN, so the preview is visually unchanged; only third-party calls are
 * cut.
 *
 * Opens are NOT lost by this: we already fetch every embedded image (including
 * the tracking pixel) once at ingest (`mirrorRemoteImages`), which is what
 * registers the open with the sender — the per-view re-fire this blocks was
 * redundant.
 */
export function emailPreviewCsp(): string {
  const imgHosts = [
    "'self'",
    "data:",
    process.env.NEXT_PUBLIC_ASSET_CDN_URL?.replace(/\/+$/, ""),
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "")
  ]
    .filter(Boolean)
    .join(" ");
  return [
    "default-src 'none'",
    `img-src ${imgHosts}`,
    "style-src 'unsafe-inline'",
    "font-src data:"
  ].join("; ");
}

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const ATTR_RE = /(\s)(src|srcset|background|data-src|data-original|data-image|data-bg)\s*=\s*("([^"]*)"|'([^']*)')/gi;
// Legacy HTML background attribute on layout tags (`<td background="...">`).
// The ATTR_RE pass above only runs inside `<img>` tags, so these need their
// own pass or the photo stays remote and the preview CSP blanks it.
const BACKGROUND_TAG_RE = /<(?:table|td|th|tr|body)\b[^>]*>/gi;
const BACKGROUND_ATTR_RE = /(\sbackground\s*=\s*)("([^"]*)"|'([^']*)')/gi;
const STYLE_TAG_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const STYLE_ATTR_RE = /(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/gi;
const URL_FN_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

// Tags whose default behaviour can navigate the viewer away from the
// preview (`<a>`, `<area>` image-map regions) or send them through a
// preference flow (`<form>`). We deliberately leave `<link>` alone so
// stylesheets keep loading, and `<base>` alone so relative image URLs
// still resolve against the original sender.
const NAVIGABLE_TAG_RE = /<(a|area|form)\b([^>]*)>/gi;
const NAVIGABLE_ATTR_RE =
  /\s(?:href|xlink:href|action|formaction|ping)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

export type RewriteOptions = {
  /** Map of original remote URL → mirrored Supabase Storage path. */
  mirrorMap: Record<string, string>;
  /** Map of mirrored storage path → short-lived signed URL. */
  signedAssets: Record<string, string>;
  /**
   * Whether to neutralise navigation targets on `<a>`, `<area>`, and
   * `<form>` tags. Defaults to `true` so user-facing previews can never
   * accidentally hit an unsubscribe / preference URL. The admin viewer
   * opts out by passing `false` so links remain inspectable.
   */
  stripLinks?: boolean;
};

export type RewriteResult = {
  html: string;
  rewritten: number;
  total: number;
  linksStripped: number;
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
    return { html: "", rewritten: 0, total: 0, linksStripped: 0 };
  }
  const shouldStripLinks = options.stripLinks !== false;

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

  const withRewrittenBackgroundAttrs = withRewrittenImgTags.replace(
    BACKGROUND_TAG_RE,
    (tag) =>
      tag.replace(BACKGROUND_ATTR_RE, (match, prefix: string, _value, dq: string | undefined, sq: string | undefined) => {
        const original = dq ?? sq ?? "";
        const replacement = resolve(original);
        if (replacement) {
          return `${prefix}"${escapeAttr(replacement)}"`;
        }
        return match;
      })
  );

  const withRewrittenStyles = withRewrittenBackgroundAttrs
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

  const stripped = shouldStripLinks
    ? stripEmailLinks(withRewrittenStyles)
    : { html: withRewrittenStyles, stripped: 0 };

  return {
    html: stripped.html,
    rewritten,
    total,
    linksStripped: stripped.stripped
  };
}

/**
 * Removes navigation targets from `<a>`, `<area>`, and `<form>` tags so
 * the rendered preview cannot trigger an unsubscribe, preference change,
 * or any other destructive action against the original sender. Visible
 * content (label text, button images, form fields) is preserved — only
 * the navigation attributes (`href`, `ping`, `action`, `formaction`)
 * are dropped.
 *
 * Defense in depth: the iframe sandbox we set on the renderer already
 * blocks scripts and form submissions, but it allows `<a>` clicks to
 * open in a new tab (`allow-popups`). Stripping the href is the only
 * way to fully neutralise the link.
 */
export function stripEmailLinks(html: string): { html: string; stripped: number } {
  if (!html) return { html: "", stripped: 0 };

  let stripped = 0;
  const next = html.replace(NAVIGABLE_TAG_RE, (_match, tag: string, attrs: string) => {
    const cleaned = attrs.replace(NAVIGABLE_ATTR_RE, () => {
      stripped += 1;
      return "";
    });
    return `<${tag}${cleaned}>`;
  });

  return { html: next, stripped };
}

type Lookup = {
  byRemote: Map<string, string>;
  byBasename: Map<string, string>;
};

function buildLookup(options: RewriteOptions): Lookup {
  const byRemote = new Map<string, string>();
  const byBasename = new Map<string, string>();

  for (const [remoteUrl, storagePath] of Object.entries(options.mirrorMap ?? {})) {
    // `signedAssets` is keyed by the deduplicated `${sha}${ext}` storage path
    // (the current layout). Older emails' mirror maps still store the historical
    // `${emailId}/${sha}${ext}` path, whose basename is exactly the dedup path —
    // so fall back to the basename when the full value misses. Without this, those
    // emails resolve no signed URLs, every image stays on its remote host, and the
    // preview CSP (which only allows our mirrored hosts) renders them all broken.
    const signed =
      options.signedAssets[storagePath] ??
      options.signedAssets[storagePathBasename(storagePath)];
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

/**
 * Last path segment of a storage path. The dedup storage layout is a flat
 * `${sha}${ext}` (no slash), so for a historical `${emailId}/${sha}${ext}`
 * value this returns the equivalent dedup key. A value with no slash is
 * returned unchanged.
 */
function storagePathBasename(storagePath: string): string {
  const lastSlash = storagePath.lastIndexOf("/");
  return lastSlash >= 0 ? storagePath.slice(lastSlash + 1) : storagePath;
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
