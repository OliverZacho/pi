/**
 * Natural-width detection for the scaled email thumbnails (Explore cards,
 * public collection cards).
 *
 * Every thumbnail renders the email inside an iframe at a nominal width and
 * scales it down with a CSS transform. Emails built wider than the nominal
 * width (700-800px layouts are common) overflow the frame to the right, so
 * the visible thumbnail shows the left edge of the layout instead of the
 * centred email. Once the frame has loaded we read the document's real
 * `scrollWidth` and widen the frame to match, which puts the layout back
 * edge-to-edge and centred.
 *
 * Reading the document requires the frame to be same-origin with the page.
 * The preview iframes therefore carry `allow-same-origin` in their sandbox,
 * which is safe here because the sandbox still withholds `allow-scripts`
 * (the email cannot run code), the render route's CSP is `default-src
 * 'none'`, and links are stripped server-side. Without that flag the
 * document is an opaque origin and `contentDocument` is `null`, and the
 * measurement silently never runs.
 */

/** Nominal render width, the layout width most emails are built for. */
export const RENDER_WIDTH = 600;

/**
 * Upper bound for the detected width. Guards against a stray oversized
 * node (a wide tracking-pixel table, an unconstrained image) inflating
 * `scrollWidth` and shrinking the whole preview.
 */
export const MAX_RENDER_WIDTH = 900;

/**
 * Sandbox flags shared by every preview thumbnail. Kept in one place so
 * `allow-same-origin` (needed for measurement) and the absence of
 * `allow-scripts` (what keeps it safe) travel together.
 */
export const PREVIEW_FRAME_SANDBOX =
  "allow-popups allow-popups-to-escape-sandbox allow-same-origin";

/**
 * Measure the natural width of a loaded preview frame, clamped to
 * [RENDER_WIDTH, MAX_RENDER_WIDTH]. Returns `null` when the document is
 * unreadable (cross-origin, not yet attached) so callers keep their
 * current width.
 */
export function measureNaturalWidth(
  frame: HTMLIFrameElement | null
): number | null {
  try {
    const doc = frame?.contentDocument;
    if (!doc) return null;
    const natural = Math.max(
      doc.documentElement?.scrollWidth ?? 0,
      doc.body?.scrollWidth ?? 0
    );
    if (natural <= 0) return null;
    return Math.min(Math.max(natural, RENDER_WIDTH), MAX_RENDER_WIDTH);
  } catch {
    return null;
  }
}
