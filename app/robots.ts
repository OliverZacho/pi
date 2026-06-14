import type { MetadataRoute } from "next";
import { SITE_URL, DISALLOWED_PATHS } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep crawlers out of the app surface, auth, the API and the
      // entire email archive — only the marketing/guide pages are public.
      // Bare prefixes block both the exact path and everything beneath it.
      disallow: [...DISALLOWED_PATHS]
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL
  };
}
