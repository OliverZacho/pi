import type { MetadataRoute } from "next";
import { SITE_URL, PUBLIC_MARKETING_PATHS } from "@/lib/site";
import { DOC_CATEGORIES } from "@/lib/docs/content";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// The brand list is DB-backed, so regenerate hourly rather than freezing the
// sitemap at build time — new brands then appear without needing a redeploy.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const marketing: MetadataRoute.Sitemap = PUBLIC_MARKETING_PATHS.map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: path === "/" ? 1 : 0.7
  }));

  // Static guide articles only — the rest of the email archive (explore,
  // collections, …) is never listed, and draft (seed-copy) articles are
  // held back until they're finished.
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

  // Per-brand pages: the public, SEO-tuned surface. The `/brands` directory
  // is the hub; each brand's slug page is a leaf. Service-role read so the
  // sitemap is independent of any visitor session. A failure here must not
  // take down the whole sitemap, so we fall back to just the hub.
  let brands: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/brands`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8
    }
  ];
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("companies")
      .select("slug, updated_at")
      .is("deleted_at", null);
    if (error) throw error;
    for (const company of data ?? []) {
      brands.push({
        url: `${SITE_URL}/brands/${company.slug}`,
        lastModified: company.updated_at ? new Date(company.updated_at) : now,
        changeFrequency: "daily",
        priority: 0.7
      });
    }
  } catch (err) {
    console.error("sitemap: failed to enumerate brands", err);
  }

  return [...marketing, ...docs, ...brands];
}
