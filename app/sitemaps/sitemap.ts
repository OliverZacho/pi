import type { MetadataRoute } from "next";
import { SITE_URL, PUBLIC_MARKETING_PATHS, SITEMAP_SECTIONS } from "@/lib/site";
import { MIN_INDEXABLE_EMAILS } from "@/lib/brand-summary";
import { DOC_CATEGORIES } from "@/lib/docs/content";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { fetchAllRows } from "@/lib/supabase-paging";

/**
 * The site's URLs as three sitemaps, one per section, listed by the index at
 * /sitemap.xml (app/sitemap.xml/route.ts). One file per section lets Search
 * Console report indexing for brand pages separately from Learn and the
 * marketing pages, which is where the indexing questions actually are.
 *
 * Served at /sitemaps/sitemap/<id>.xml.
 */
type SitemapSection = (typeof SITEMAP_SECTIONS)[number];

// The brand list is DB-backed, so regenerate hourly rather than freezing the
// sitemap at build time: new brands then appear without needing a redeploy.
export const revalidate = 3600;

export async function generateSitemaps() {
  return SITEMAP_SECTIONS.map((id) => ({ id }));
}

export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const id = (await props.id) as SitemapSection;
  switch (id) {
    case "pages":
      return marketingEntries();
    case "learn":
      return learnEntries();
    case "brands":
      return brandEntries();
    default:
      return [];
  }
}

// Static pages carry no lastModified: we don't track real edit dates for them,
// and a blanket "modified now" on every URL teaches Google to distrust the
// field for the URLs where it *is* real (brands below).
function marketingEntries(): MetadataRoute.Sitemap {
  return PUBLIC_MARKETING_PATHS.map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    changeFrequency: "weekly",
    priority: path === "/" ? 1 : 0.7
  }));
}

// Static guide articles only. The rest of the email archive (explore,
// collections, …) is never listed, and draft (seed-copy) articles are held
// back until they're finished.
function learnEntries(): MetadataRoute.Sitemap {
  return DOC_CATEGORIES.flatMap((category) =>
    category.articles
      .filter((article) => !article.draft)
      .map((article) => ({
        url: `${SITE_URL}/learn/${article.slug}`,
        changeFrequency: "monthly" as const,
        priority: 0.6
      }))
  );
}

/**
 * The brand hubs plus every indexable brand page.
 *
 * Only brands with enough captured email to say something real are listed
 * (mirroring the noindex gate on the page itself): inviting Google to crawl
 * hundreds of near-empty templates reads as scaled thin content.
 *
 * A brand page's lastModified is the brand's latest captured email, because
 * that is what changes the page: its KPI tiles, send calendar and summary.
 * `companies.updated_at` (used before) moved on admin edits but not on new
 * email, so it told Google nothing about fresh content.
 */
async function brandEntries(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/brands`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/brands/a-z`, changeFrequency: "daily", priority: 0.6 }
  ];
  try {
    // Paged: PostgREST stops at 1,000 rows, and an unpaged read would quietly
    // drop every brand past that from the sitemap.
    const companies = await fetchAllRows((from, to) =>
      getSupabaseAdmin()
        .from("companies")
        .select(
          "slug, updated_at, company_email_stats(email_count, last_received_at)"
        )
        .is("deleted_at", null)
        .order("id")
        .range(from, to)
    );
    for (const company of companies) {
      if (!company.slug) continue;
      const stats = Array.isArray(company.company_email_stats)
        ? company.company_email_stats[0]
        : company.company_email_stats;
      if ((stats?.email_count ?? 0) < MIN_INDEXABLE_EMAILS) continue;
      const lastModified = stats?.last_received_at ?? company.updated_at;
      entries.push({
        url: `${SITE_URL}/brands/${company.slug}`,
        lastModified: lastModified ? new Date(lastModified) : undefined,
        changeFrequency: "daily",
        priority: 0.7
      });
    }
  } catch (err) {
    // A failure must not take down the section; fall back to the hubs.
    console.error("sitemap: failed to enumerate brands", err);
  }
  return entries;
}
