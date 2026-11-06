import { SITE_URL, SITEMAP_SECTIONS } from "@/lib/site";

/**
 * /sitemap.xml: the sitemap index, pointing at one sitemap per section
 * (app/sitemaps/sitemap.ts). Kept at the old URL so robots.txt and the
 * Search Console submission keep working unchanged.
 *
 * No <lastmod> here: each section's own URLs carry the dates that matter.
 */
export const dynamic = "force-static";

export function GET() {
  const sitemaps = SITEMAP_SECTIONS.map(
    (id) =>
      `  <sitemap>\n    <loc>${SITE_URL}/sitemaps/sitemap/${id}.xml</loc>\n  </sitemap>`
  ).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemaps}\n</sitemapindex>\n`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" }
  });
}
