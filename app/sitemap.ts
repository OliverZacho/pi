import type { MetadataRoute } from "next";
import { SITE_URL, PUBLIC_MARKETING_PATHS } from "@/lib/site";
import { DOC_CATEGORIES } from "@/lib/docs/content";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const marketing: MetadataRoute.Sitemap = PUBLIC_MARKETING_PATHS.map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: path === "/" ? 1 : 0.7
  }));

  // Static guide articles only — the email archive is never listed, and
  // draft (seed-copy) articles are held back until they're finished.
  const docs: MetadataRoute.Sitemap = DOC_CATEGORIES.flatMap((category) =>
    category.articles
      .filter((article) => !article.draft)
      .map((article) => ({
      url: `${SITE_URL}/docs/${article.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.6
    }))
  );

  return [...marketing, ...docs];
}
