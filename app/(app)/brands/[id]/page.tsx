import { cache } from "react";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getViewer } from "@/lib/access";
import { normalizeCompanyMarkets } from "@/lib/explore-db";
import { resolveBrandLogo } from "@/lib/logo-dev";
import { BRAND_LOGO_TRANSFORM, getSignedAssets } from "@/lib/storage";
import BrandLockedDashboard from "@/components/brand/BrandLockedDashboard";
import {
  getBrandPageData,
  getBrandSummary,
  resolveBrandHandle
} from "@/lib/brand-db";
import { SITE_URL } from "@/lib/site";
import { MIN_INDEXABLE_EMAILS } from "@/lib/brand-summary";
import { ORGANIZATION_ID } from "@/lib/structured-data";
import {
  listCompetitorSetSummaries,
  listSetIdsContainingBrand,
  type CompetitorSetSummary
} from "@/lib/competitor-db";
import { isBrandFollowed } from "@/lib/follows-db";
import { DEMO_BRAND_SLUG } from "@/lib/demo";
import BrandDashboard from "@/components/brand/BrandDashboard";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ segment?: string | string[] }>;
};

/**
 * Request-memoised handle→identity resolve and summary build, so
 * `generateMetadata` and the page body each run once per request rather than
 * twice. `getSupabaseAdmin` is a singleton, so keying on the string args is
 * stable.
 */
const resolveHandle = cache((handle: string) =>
  resolveBrandHandle(getSupabaseAdmin(), handle)
);
const loadBrandSummary = cache((id: string, name: string) =>
  getBrandSummary(getSupabaseAdmin(), id, { name })
);

/**
 * The public teaser: the brand's real KPI tiles + send calendar, served to
 * *every* locked viewer — including logged-out visitors and crawlers. This is
 * what makes each brand page unique, honest content (no shared sample data in
 * the crawlable HTML). The heavy dashboard query is too expensive to run per
 * anonymous request, so the subset is cached across requests for an hour —
 * fine for a teaser that changes at most a few times a day.
 */
const loadPublicTeaser = unstable_cache(
  async (companyId: string) => {
    const data = await getBrandPageData(getSupabaseAdmin(), companyId);
    if (!data) return null;
    return {
      totals: data.totals,
      cadence: data.cadence,
      promo: data.promo,
      esp: data.esp,
      calendar: data.calendar
    };
  },
  ["brand-public-teaser"],
  { revalidate: 3600 }
);

/**
 * Same-market brands for the cross-link strip on the public page. Only
 * brands that clear the indexability threshold are linked — pointing
 * crawlers at noindexed pages wastes the crawl. Cached hourly; the list
 * barely changes.
 */
const loadRelatedBrands = unstable_cache(
  async (companyId: string, markets: string[]) => {
    const admin = getSupabaseAdmin();
    let query = admin
      .from("companies")
      .select("slug, name, company_email_stats(email_count)")
      .neq("id", companyId)
      .is("deleted_at", null)
      .limit(24);
    if (markets.length > 0) {
      query = query.overlaps("markets", markets);
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .filter((row) => {
        const stats = Array.isArray(row.company_email_stats)
          ? row.company_email_stats[0]
          : row.company_email_stats;
        return (stats?.email_count ?? 0) >= MIN_INDEXABLE_EMAILS;
      })
      .slice(0, 6)
      .map((row) => ({ slug: row.slug, name: row.name }));
  },
  ["brand-related"],
  { revalidate: 3600 }
);

/**
 * Per-brand SaaS-style dashboard. The companion to `/explore`: where
 * Explore answers "show me what's hitting inboxes", this page answers
 * "tell me everything you know about this one brand's email program".
 *
 * Auth gating mirrors the Explore route — the email render endpoint each
 * thumbnail iframe consumes is admin-only today, and there's no value
 * in showing partial analytics to logged-out viewers.
 */
export async function generateMetadata({ params }: RouteParams) {
  const { id } = await params;
  // Resolve via the service-role client: companies aren't readable under RLS
  // for logged-out visitors / crawlers, which is exactly who reads <head>.
  const resolved = await resolveHandle(id);
  if (!resolved) {
    return { title: "Brand — Pirol" };
  }

  // Canonical always points at the slug URL, so Google consolidates any
  // legacy /brands/<uuid> links onto the keyword-bearing slug without us
  // having to 301 (and slow down) internal navigation.
  const canonical = `${SITE_URL}/brands/${resolved.slug}`;
  const summary = await loadBrandSummary(resolved.id, resolved.name);

  // Only pages with enough captured email to say something real are offered
  // to the index (same threshold as the sitemap). The rest stay reachable but
  // noindexed — hundreds of near-empty templates would read as scaled thin
  // content and drag every strong page down with them.
  const indexable =
    summary !== null && summary.emailCount >= MIN_INDEXABLE_EMAILS;

  // Keyword-bearing title: people find these pages searching
  // "<brand> email frequency / newsletter strategy", not "<brand> Pirol".
  const title = indexable
    ? `${resolved.name} email marketing: frequency, timing, discounts`
    : `${resolved.name} — Pirol`;

  return {
    title,
    description: summary?.metaDescription ?? undefined,
    alternates: { canonical },
    openGraph: { url: canonical, title },
    robots: indexable ? undefined : { index: false, follow: true }
  };
}

export default async function BrandPage({ params, searchParams }: RouteParams) {
  const { id: handle } = await params;
  const { segment } = await searchParams;
  const segmentInboxId = Array.isArray(segment) ? segment[0] : segment ?? null;
  const supabase = await createClient();

  // The path segment may be a slug or a legacy UUID; resolve to the real id
  // up front so both the locked and unlocked paths below work either way.
  // Handle resolution (service-role) and viewer auth are independent, so
  // they run together — serially they'd add a full DB round-trip each to
  // every brand page view.
  const [resolved, viewer] = await Promise.all([
    resolveHandle(handle),
    getViewer()
  ]);
  if (!resolved) {
    notFound();
  }
  const id = resolved.id;

  // Logged-out / unpaid viewers see the brand page with full structure —
  // hero + every section heading — but the data locked behind upgrade CTAs.
  // Only light brand identity is fetched (service-role); the heavy analytics
  // (`getBrandPageData`) are skipped entirely.
  if (!viewer || !viewer.hasAccess) {
    // The onboarding tour's demo brand is the one exception: unpaid users get
    // its real dashboard (data fetched service-side past RLS) so they can see
    // what a brand page actually offers. Read-only — no follow / group actions.
    if (resolved.slug === DEMO_BRAND_SLUG) {
      const demoData = await getBrandPageData(getSupabaseAdmin(), id, {
        segmentInboxId
      });
      if (demoData) {
        return (
          <BrandDashboard
            data={demoData}
            isFollowing={false}
            groups={[]}
            groupMembershipIds={[]}
          />
        );
      }
    }

    const admin = getSupabaseAdmin();
    // Identity, summary, and (for signed-in free viewers) follow state +
    // the real dashboard payload are independent — fetch together. The
    // service-role client is used throughout because free tokens have no
    // RLS grants here. The heavy dashboard query only runs for signed-in
    // viewers, so logged-out / crawler traffic stays on the cheap path.
    const [{ data: company }, summary, isFollowing, liveData] =
      await Promise.all([
        admin
          .from("companies")
          .select(
            "id, name, domain, markets, primary_market_country, is_global, logo_storage_path, logo_source, subscribed_since, deleted_at"
          )
          .eq("id", id)
          .maybeSingle(),
        loadBrandSummary(id, resolved.name),
        viewer
          ? isBrandFollowed(admin, viewer.userId, id).catch((err) => {
              console.error("Failed to load follow state for locked brand", err);
              return false;
            })
          : Promise.resolve(false),
        viewer
          ? getBrandPageData(admin, id)
              .then((data) =>
                data
                  ? {
                      totals: data.totals,
                      cadence: data.cadence,
                      promo: data.promo,
                      esp: data.esp,
                      calendar: data.calendar
                    }
                  : null
              )
              .catch((err) => {
                console.error("Failed to load live teaser data", err);
                return null;
              })
          : // Logged-out visitors (and crawlers) get the same real teaser,
            // but from the shared hourly cache — the heavy query never runs
            // per anonymous request.
            loadPublicTeaser(id).catch((err) => {
              console.error("Failed to load public teaser", err);
              return null;
            })
      ]);

    if (!company || company.deleted_at) {
      notFound();
    }

    let logoUrl: string | null = null;
    if (company.logo_storage_path) {
      try {
        const signed = await getSignedAssets([company.logo_storage_path], {
          transform: BRAND_LOGO_TRANSFORM
        });
        logoUrl = signed[company.logo_storage_path] ?? null;
      } catch (err) {
        console.error("Failed to sign brand logo", err);
      }
    }
    logoUrl = resolveBrandLogo(logoUrl, company.logo_source, company.domain);

    const marketLabels = normalizeCompanyMarkets(company.markets);
    const related = await loadRelatedBrands(
      id,
      Array.isArray(company.markets) ? company.markets : []
    ).catch((err) => {
      console.error("Failed to load related brands", err);
      return [] as { slug: string; name: string }[];
    });

    // Structured data for the public page: the breadcrumb trail plus the
    // brand's email program described as a Dataset published by Pirol.
    // Only emitted when the page is indexable — schema on a noindexed page
    // is noise.
    const indexable =
      summary !== null && summary.emailCount >= MIN_INDEXABLE_EMAILS;
    const canonical = `${SITE_URL}/brands/${resolved.slug}`;
    const jsonLd = indexable
      ? [
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Brands",
                item: `${SITE_URL}/brands`
              },
              {
                "@type": "ListItem",
                position: 2,
                name: company.name,
                item: canonical
              }
            ]
          },
          {
            "@context": "https://schema.org",
            "@type": "Dataset",
            name: `${company.name} email marketing data`,
            description: summary.paragraph,
            url: canonical,
            creator: { "@id": ORGANIZATION_ID },
            isAccessibleForFree: false
          }
        ]
      : null;

    return (
      <>
        {jsonLd ? (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
          />
        ) : null}
        <BrandLockedDashboard
          brand={{
            name: company.name,
            domain: company.domain ?? null,
            markets: marketLabels,
            primaryMarketCountry: company.primary_market_country ?? null,
            isGlobal: Boolean(company.is_global),
            logoUrl,
            subscribedSince: company.subscribed_since ?? null
          }}
          summary={summary?.paragraph ?? null}
          follow={
            viewer ? { brandId: id, initialFollowing: isFollowing } : undefined
          }
          live={liveData ?? undefined}
          related={related.map((r) => ({
            ...r,
            marketLabel: marketLabels[0] ?? null
          }))}
        />
      </>
    );
  }

  const userId = viewer.userId;

  // The dashboard payload is the heavy query; the comparison groups,
  // follow state, and group memberships are all independent of it, so
  // fan everything out together instead of awaiting in a chain. Each
  // auxiliary source swallows its own error — only a missing dashboard
  // payload 404s the page.
  const [data, groups, isFollowing, groupMembershipIds] = await Promise.all([
    getBrandPageData(supabase, id, { segmentInboxId }),
    listCompetitorSetSummaries(supabase, userId).catch((err) => {
      console.error("Failed to load competitor sets", err);
      return [] as CompetitorSetSummary[];
    }),
    isBrandFollowed(supabase, userId, id).catch((err) => {
      console.error("Failed to load follow status", err);
      return false;
    }),
    listSetIdsContainingBrand(supabase, userId, id).catch((err) => {
      console.error("Failed to load group memberships", err);
      return new Set<string>();
    })
  ]);

  if (!data) {
    notFound();
  }

  return (
    <BrandDashboard
      data={data}
      isFollowing={isFollowing}
      groups={groups}
      groupMembershipIds={Array.from(groupMembershipIds)}
    />
  );
}
