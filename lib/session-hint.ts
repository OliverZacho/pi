/**
 * Session presence hint for statically rendered pages.
 *
 * Marketing pages are served from the CDN, so the server can't know who is
 * looking. The Supabase auth cookie (`sb-<ref>-auth-token`, chunked as
 * `.0`, `.1`… when large) is readable from JS, which is enough to decide
 * before first paint whether to hold back the logged-out UI. It is only a
 * hint: the real session is resolved client-side afterwards.
 */
const SESSION_COOKIE_RE = /(?:^|;\s*)sb-[^=]+-auth-token(?:\.\d+)?=/;

export function hasSessionCookie(): boolean {
  return typeof document !== "undefined" && SESSION_COOKIE_RE.test(document.cookie);
}

/**
 * Inline <head> script (root layout): marks `<html data-session>` before the
 * body parses, so CSS can hide guest-only buttons before React hydrates.
 * Header clears it once the real session has been read.
 */
export const SESSION_HINT_SCRIPT = `if(${SESSION_COOKIE_RE}.test(document.cookie))document.documentElement.setAttribute("data-session","")`;

export function clearSessionHint(): void {
  document.documentElement.removeAttribute("data-session");
}
