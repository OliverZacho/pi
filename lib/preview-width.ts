/**
 * Natural-width detection for the scaled email thumbnails (Explore cards,
 * public collection cards).
 *
 * Every thumbnail renders the email inside an iframe at a nominal width and
 * scales it down with a CSS transform. Emails built wider than the nominal
 * width (700-800px layouts are common) overflow the frame to the right, so
 * the visible thumbnail shows the left edge of the layout instead of the
 * centred email. Once we know the document's real width we widen the frame
 * to match, which puts the layout back edge-to-edge and centred.
 *
 * The parent page never reads the frame's document. The frame is a
 * sandboxed, opaque-origin document (no `allow-same-origin`), so its
 * requests carry none of the viewer's cookies and it cannot touch this
 * page. Instead the render route embeds a fixed measuring script
 * (`PREVIEW_MEASURE_SCRIPT` in lib/email-render.ts) that posts the
 * document's `scrollWidth` to the parent. `allow-scripts` lets that script
 * run; the render route's CSP allows only that script's hash, so the
 * email's own scripts, inline handlers and javascript: URLs stay blocked.
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
 * Sandbox flags shared by every preview thumbnail. `allow-scripts` without
 * `allow-same-origin` is the combination the sandbox is designed for: the
 * document can run (only) the CSP-allowed measuring script, but has no
 * origin, no cookies and no way to reach the parent beyond postMessage.
 */
export const PREVIEW_FRAME_SANDBOX =
  "allow-popups allow-popups-to-escape-sandbox allow-scripts";

/** `type` of the message the measuring script posts to the parent. */
export const PREVIEW_WIDTH_MESSAGE = "pirol:preview-width";

/** `type` of the message a parent posts to ask the frame to measure again. */
export const PREVIEW_MEASURE_REQUEST = "pirol:preview-measure";

/**
 * Clamp a reported natural width to [RENDER_WIDTH, MAX_RENDER_WIDTH].
 * Returns `null` for anything unusable so callers keep their current width.
 */
export function clampNaturalWidth(natural: unknown): number | null {
  if (typeof natural !== "number" || !Number.isFinite(natural) || natural <= 0) {
    return null;
  }
  return Math.min(Math.max(natural, RENDER_WIDTH), MAX_RENDER_WIDTH);
}

/**
 * Listen for the measuring script's width reports from `frame`, clamped via
 * {@link clampNaturalWidth}. Messages are matched on the sending window
 * (the frame's origin is opaque, so `event.origin` is always "null" and
 * proves nothing). Also asks the frame to measure right away, in case a
 * cached document already reported before we were listening. Returns the
 * unsubscribe function.
 */
export function subscribeToPreviewWidth(
  frame: HTMLIFrameElement,
  onWidth: (width: number) => void
): () => void {
  function onMessage(event: MessageEvent) {
    if (!frame.contentWindow || event.source !== frame.contentWindow) return;
    const data = event.data as { type?: unknown; width?: unknown } | null;
    if (!data || data.type !== PREVIEW_WIDTH_MESSAGE) return;
    const width = clampNaturalWidth(data.width);
    if (width !== null) onWidth(width);
  }
  window.addEventListener("message", onMessage);
  try {
    frame.contentWindow?.postMessage({ type: PREVIEW_MEASURE_REQUEST }, "*");
  } catch {
    // Frame not ready yet; the script reports on its own once it runs.
  }
  return () => window.removeEventListener("message", onMessage);
}
