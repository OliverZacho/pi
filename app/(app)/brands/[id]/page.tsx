import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/access";
import {
  listCompetitorSetSummaries,
  listSetIdsContainingBrand,
  type CompetitorSetSummary
} from "@/lib/competitor-db";
import { isBrandFollowed } from "@/lib/follows-db";
import { getBrandPageData } from "@/lib/brand-db";
import { loadRelatedBrands } from "@/lib/brand-link-index";
import BrandDashboard from "@/components/brand/BrandDashboard";
import { resolveHandle } from "./resolve-handle";
import { brandPageMetadata } from "./brand-metadata";
import LockedBrandView from "./LockedBrandView";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ segment?: string | string[] }>;
};

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
  // Signed-in viewers only: see brandPageMetadata for why the narrative is
  // left out here.
  return brandPageMetadata(id, { narrative: false });
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
    return (
      <LockedBrandView
        resolved={resolved}
        viewer={viewer}
        segmentInboxId={segmentInboxId}
      />
    );
  }

  const userId = viewer.userId;

  // The dashboard payload is the heavy query; the comparison groups,
  // follow state, and group memberships are all independent of it, so
  // fan everything out together instead of awaiting in a chain. Each
  // auxiliary source swallows its own error — only a missing dashboard
  // payload 404s the page.
  const [data, groups, isFollowing, groupMembershipIds, related] =
    await Promise.all([
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
      }),
      // Served from the hourly cache and picked in memory; never throws.
      loadRelatedBrands(id)
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
      related={related}
    />
  );
}
