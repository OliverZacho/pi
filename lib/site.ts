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
  "/features/comparisons",
  "/privacy",
  "/terms",
  "/takedown"
] as const;

/**
 * AI *training* crawlers — bots that harvest text to train models with no
 * referral upside. Blocked from the whole site in robots.txt.
 *
 * Deliberately NOT listed (so they fall under the permissive `*` rule and
 * keep driving referral traffic): search + AI *retrieval/citation* bots such
 * as Googlebot, Bingbot, Applebot, OAI-SearchBot, ChatGPT-User, PerplexityBot,
 * Perplexity-User, Claude-User and Claude-SearchBot. These fetch a page live
 * to answer a user and link back to us.
 *
 * Note: robots.txt is honour-system — only polite bots obey it. Hard blocking
 * against spoofers happens at the edge (Cloudflare WAF / "Block AI bots").
 */
export const AI_TRAINING_BOTS = [
  "GPTBot", // OpenAI model training
  "CCBot", // Common Crawl — feeds many training datasets
  "anthropic-ai", // legacy Anthropic training crawler
  "ClaudeBot", // Anthropic training crawler (Claude-User / Claude-SearchBot stay allowed)
  "Applebot-Extended", // Apple AI training (plain Applebot stays allowed for search/Siri)
  "Google-Extended", // Gemini/Vertex training — does NOT affect Google Search or AI Overviews
  "Bytespider", // ByteDance/TikTok — aggressive scraper
  "Meta-ExternalAgent", // Meta AI training
  "Amazonbot", // Amazon AI/Alexa harvesting
  "Omgilibot", // Webz.io — data reselling
  "Diffbot", // data-extraction reseller
  "PetalBot", // Huawei crawler
  "Timpibot" // Timpi crawler
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
