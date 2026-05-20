import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  BRANDS_PAGE_SIZE,
  getBrandsFacets,
  searchBrands
} from "@/lib/brands-explore-db";
import BrandsExploreClient from "@/components/brand/BrandsExploreClient";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
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
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login?next=/brands");
  }

  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    redirect("/access-denied");
  }

  const [initialResult, facets] = await Promise.all([
    searchBrands(supabase, {
      page: 1,
      pageSize: BRANDS_PAGE_SIZE,
      sort: "most_active"
    }),
    getBrandsFacets(supabase)
  ]);

  return (
    <div className={styles.shell}>
      <ExploreSidebar activeId="brands" />

      <main className={styles.main}>
        <header className={styles.heading}>
          <div className={styles.headingRow}>
            <div>
              <h1>Brands</h1>
              <p>Search every tracked competitor and filter by what we know.</p>
            </div>
            <div className={styles.headingStats} aria-label="Brand totals">
              <div className={styles.headingStat}>
                <span className={styles.headingStatValue}>
                  {formatNumber(facets.totalBrands)}
                </span>
                <span className={styles.headingStatLabel}>Tracked brands</span>
              </div>
              <div className={styles.headingStat}>
                <span className={styles.headingStatValue}>
                  {formatNumber(facets.brandsWithEmails)}
                </span>
                <span className={styles.headingStatLabel}>With captured emails</span>
              </div>
              <div className={styles.headingStat}>
                <span className={styles.headingStatValue}>
                  {formatNumber(facets.markets.length)}
                </span>
                <span className={styles.headingStatLabel}>Categories</span>
              </div>
            </div>
          </div>
        </header>

        <BrandsExploreClient
          initialBrands={initialResult.items}
          initialHasMore={initialResult.hasMore}
          initialTotal={initialResult.total}
          pageSize={BRANDS_PAGE_SIZE}
          facets={facets}
        />
      </main>
    </div>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
