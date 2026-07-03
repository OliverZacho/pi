import { createClient } from "@/lib/supabase/server";
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
import { getViewer } from "@/lib/access";
import BrandsExploreClient from "@/components/brand/BrandsExploreClient";
import styles from "@/components/brand/brands-explore.module.css";

export const metadata = {
  title: "Brands — Pirol"
};

export const dynamic = "force-dynamic";

/**
 * `/brands` — the brand explorer.
 *
 * Lists every tracked company as a clickable card and lets the user
 * filter / sort across them. Mirrors the auth gate from `/explore`
 * (admin-only today) so the two pages feel like one product.
 *
 * The first page of results + the markets facet are server-rendered
 * so the grid is hydrated with real cards on first paint. The client
 * island below takes over for live filtering / search / infinite
 * scroll via the `/api/brands/*` routes.
 */
export default async function BrandsPage() {
  const supabase = await createClient();
  const viewer = await getViewer();

  // The brand directory is fully browsable for everyone — logged-out /
  // unpaid visitors get the same search/filter directory (via the public,
  // service-role API), they just can't open a brand's locked analytics.
  if (!viewer || !viewer.hasAccess) {
    const admin = getSupabaseAdmin();
    const [publicResult, publicFacets] = await Promise.all([
      searchBrands(admin, {
        page: 1,
        pageSize: BRANDS_PAGE_SIZE,
        sort: "most_active"
      }),
      getBrandsFacets(admin)
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
        />
      </main>
    );
  }

  const userId = viewer.userId;

  // All independent — fan them out in one parallel batch instead of a chain
  // of awaits so the page's server time is one round-trip, not four.
  // Comparisons and the followed-brand ids each swallow their own errors
  // so one missing table can't take down the directory.
  const [initialResult, facets, comparisons, followedBrandIdSet] =
    await Promise.all([
      searchBrands(supabase, {
        page: 1,
        pageSize: BRANDS_PAGE_SIZE,
        sort: "most_active"
      }),
      getBrandsFacets(supabase),
      // Feeds the batch bar's "Add to comparison" action.
      listCompetitorSetSummaries(supabase, userId).catch((err) => {
        console.error("Failed to load comparisons", err);
        return [] as CompetitorSetSummary[];
      }),
      // Followed brand ids power the batch bar's follow/unfollow action.
      listFollowedBrandIds(supabase, userId).catch((err) => {
        console.error("Failed to load followed brands", err);
        return new Set<string>();
      })
    ]);
  const followedBrandIds = Array.from(followedBrandIdSet);

  return (
    <main className={styles.main}>
      <header className={styles.heading}>
        <div className={styles.headingRow}>
          <div>
            <h1>Brands</h1>
            <p>Search every tracked brand and filter by what we know.</p>
          </div>
        </div>
      </header>

      <BrandsExploreClient
        initialBrands={initialResult.items}
        initialHasMore={initialResult.hasMore}
        initialTotal={initialResult.total}
        pageSize={BRANDS_PAGE_SIZE}
        facets={facets}
        comparisons={comparisons}
        initialFollowedBrandIds={followedBrandIds}
      />
    </main>
  );
}
