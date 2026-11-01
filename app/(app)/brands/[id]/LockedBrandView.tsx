import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { Viewer } from "@/lib/access";
import { normalizeCompanyMarkets } from "@/lib/explore-db";
import { resolveBrandLogo } from "@/lib/logo-dev";
import { BRAND_LOGO_TRANSFORM, getSignedAssets } from "@/lib/storage";
import BrandLockedDashboard from "@/components/brand/BrandLockedDashboard";
import { loadIndexableBrands, pickRelatedBrands } from "@/lib/brand-link-index";
import { getBrandPageData } from "@/lib/brand-db";
import { SITE_URL } from "@/lib/site";
import { MIN_INDEXABLE_EMAILS } from "@/lib/brand-summary";
import { ORGANIZATION_ID } from "@/lib/structured-data";
import { isBrandFollowed } from "@/lib/follows-db";
import { DEMO_BRAND_SLUG } from "@/lib/demo";
import BrandDashboard from "@/components/brand/BrandDashboard";
import {
  loadBrandNarrative,
  loadBrandSummary,
  loadPublicTeaser
} from "./brand-metadata";

/**
 * The brand page for viewers without access: logged-out visitors (served
 * cached from app/guest/brands/[id]) and signed-in free users (rendered per
 * request by the brand route, with follow state and live teaser data).
 *
 * With `viewer` null this must read nothing request-specific (no cookies, no
 * session client): the guest route caches its output for every visitor.
 */
export default async function LockedBrandView({
  resolved,
  viewer,
  segmentInboxId
}: {
  resolved: { id: string; slug: string; name: string };
  viewer: Viewer | null;
  segmentInboxId: string | null;
}) {
  const id = resolved.id;

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
  const [{ data: company }, summary, narrative, isFollowing, liveData] =
    await Promise.all([
      admin
        .from("companies")
        .select(
          "id, name, domain, markets, primary_market_country, is_global, logo_storage_path, logo_source, subscribed_since, deleted_at"
        )
        .eq("id", id)
        .maybeSingle(),
      loadBrandSummary(id, resolved.name),
      loadBrandNarrative(id, resolved.name).catch((err) => {
        console.error("Failed to load brand narrative", err);
        return null;
      }),
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
  // Same-market brands for the cross-link strip, picked as a ring so every
  // indexable brand is linked from its neighbours (lib/brand-link-index.ts).
  const related = await loadIndexableBrands()
    .then((index) =>
      pickRelatedBrands(index, {
        id,
        name: company.name,
        markets: marketLabels
      })
    )
    .catch((err) => {
      console.error("Failed to load related brands", err);
      return { brands: [], sharedMarket: null };
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
        narrative={narrative}
        follow={
          viewer ? { brandId: id, initialFollowing: isFollowing } : undefined
        }
        live={liveData ?? undefined}
        related={related.brands.map((r) => ({
          ...r,
          marketLabel: related.sharedMarket
        }))}
      />
    </>
  );
}
