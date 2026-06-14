/**
 * Canonical, public-facing origin for the site. Used by sitemap.ts,
 * robots.ts, llms.txt and metadataBase so every canonical URL agrees.
 *
 * Override per-environment with NEXT_PUBLIC_SITE_URL (no trailing slash).
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://pirol.app"
).replace(/\/$/, "");

/**
 * Public marketing / guide routes that are safe to index. The email
 * archive (explore, brands, collections, …) is intentionally absent —
 * crawlers should never be invited to walk the catalogue.
 */
export const PUBLIC_MARKETING_PATHS = [
  "/",
  "/pricing",
  "/learn",
  "/help",
  "/docs",
  "/features/collections",
  "/features/comparisons"
] as const;

/**
 * Path prefixes crawlers must not enter: the app surface, auth, the API,
 * and the entire email archive/catalogue.
 */
export const DISALLOWED_PATHS = [
  "/admin",
  "/api",
  "/auth",
  "/login",
  "/access-denied",
  "/settings",
  "/saved",
  "/dashboard",
  "/following",
  "/explore",
  "/brands",
  "/collections",
  "/compare",
  "/c"
] as const;
