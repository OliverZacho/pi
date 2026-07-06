import { cache } from "react";
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
  const title = `${resolved.name} — Pirol`;
  const summary = await loadBrandSummary(resolved.id, resolved.name);

  return {
    title,
    description: summary?.metaDescription ?? undefined,
    alternates: { canonical },
    openGraph: { url: canonical, title }
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
    // Identity and summary are independent — fetch together. The summary
    // is only wasted on a 404, the rare case.
    const [{ data: company }, summary] = await Promise.all([
      admin
        .from("companies")
        .select(
          "id, name, domain, markets, primary_market_country, is_global, logo_storage_path, logo_source, subscribed_since, deleted_at"
        )
        .eq("id", id)
        .maybeSingle(),
      loadBrandSummary(id, resolved.name)
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

    return (
      <BrandLockedDashboard
        brand={{
          name: company.name,
          domain: company.domain ?? null,
          markets: normalizeCompanyMarkets(company.markets),
          primaryMarketCountry: company.primary_market_country ?? null,
          isGlobal: Boolean(company.is_global),
          logoUrl,
          subscribedSince: company.subscribed_since ?? null
        }}
        summary={summary?.paragraph ?? null}
      />
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
