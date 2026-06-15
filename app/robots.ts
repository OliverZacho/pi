import type { MetadataRoute } from "next";
import { SITE_URL, DISALLOWED_PATHS, AI_TRAINING_BOTS } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        // Everyone else — including search engines and AI *retrieval/citation*
        // bots (Googlebot, Bingbot, Applebot, OAI-SearchBot, ChatGPT-User,
        // PerplexityBot, Claude-User, Claude-SearchBot…). These drive referral
        // traffic, so they get the public marketing/guide surface. The app,
        // auth, API and the entire email archive stay off-limits. Bare prefixes
        // block both the exact path and everything beneath it.
        userAgent: "*",
        allow: "/",
        disallow: [...DISALLOWED_PATHS]
      },
      {
        // AI *training* crawlers: pure harvest, no referral upside. Blocked
        // from the whole site. (Honoured only by polite bots — enforcement
        // against spoofers lives in the Cloudflare WAF.)
        userAgent: [...AI_TRAINING_BOTS],
        disallow: "/"
      }
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL
  };
}
