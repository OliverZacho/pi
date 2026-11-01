import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  BRANDS_PAGE_SIZE,
  getBrandsFacets,
  searchBrands
} from "@/lib/brands-explore-db";
import {
  listCompetitorSetSummaries,
  type CompetitorSetSummary
} from "@/lib/competitor-db";
import { listFollowedBrandIds } from "@/lib/follows-db";
import type { Viewer } from "@/lib/access";
import BrandsExploreClient from "@/components/brand/BrandsExploreClient";
import styles from "@/components/brand/brands-explore.module.css";

/**
 * The brand directory for viewers without access: logged-out visitors
 * (served cached from app/guest/brands) and signed-in free users (rendered
 * per request, with their follow and comparison state).
 *
 * With `viewer` null this must read nothing request-specific: the guest
 * route caches its output for every visitor.
 */
export default async function LockedBrandsDirectory({
  viewer
}: {
  viewer: Viewer | null;
}) {
  const admin = getSupabaseAdmin();
  // Signed-in free users can select brands to follow (capped) and fill
  // their one comparison, so their follow/comparison state loads too —
  // via the service-role client (free tokens have no RLS grants on
  // those tables; both helpers filter by user id).
  const [publicResult, publicFacets, freeComparisons, freeFollowedIds] =
    await Promise.all([
      searchBrands({
        page: 1,
        pageSize: BRANDS_PAGE_SIZE,
        sort: "most_active"
      }),
      getBrandsFacets(),
      viewer
        ? listCompetitorSetSummaries(admin, viewer.userId).catch((err) => {
            console.error("Failed to load comparisons", err);
            return [] as CompetitorSetSummary[];
          })
        : Promise.resolve([] as CompetitorSetSummary[]),
      viewer
        ? listFollowedBrandIds(admin, viewer.userId).catch((err) => {
            console.error("Failed to load followed brands", err);
            return new Set<string>();
          })
        : Promise.resolve(new Set<string>())
    ]);

  return (
    <main className={styles.main}>
      <header className={styles.heading}>
        <div className={styles.headingRow}>
          <div>
            <h1>Brands</h1>
            <p>
              Search every tracked brand and filter by what we know.
            </p>
          </div>
          <Link href="/brands/a-z" className={styles.azLink}>
            All brands A to Z
          </Link>
        </div>
      </header>

      <BrandsExploreClient
        initialBrands={publicResult.items}
        initialHasMore={publicResult.hasMore}
        initialTotal={publicResult.total}
        pageSize={BRANDS_PAGE_SIZE}
        facets={publicFacets}
        searchEndpoint="/api/public/brands/list"
        isPublic
        allowFollow={Boolean(viewer)}
        comparisons={freeComparisons}
        initialFollowedBrandIds={Array.from(freeFollowedIds)}
      />
    </main>
  );
}
