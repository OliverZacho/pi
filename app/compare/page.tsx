import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  dedupeBrandIds,
  getCompetitorComparison,
  listCompetitorSetSummaries,
  MAX_BRANDS_PER_COMPARISON,
  type CompetitorSetBrand
} from "@/lib/competitor-db";
import { listCollectionSummaries } from "@/lib/collections-db";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import CompareBrandStrip from "@/components/compare/CompareBrandStrip";
import CompareDashboard from "@/components/compare/CompareDashboard";
import CompareLandingClient from "@/components/compare/CompareLandingClient";
import styles from "@/components/compare/compare.module.css";
import { BRAND_LOGO_TRANSFORM, getSignedAssets } from "@/lib/storage";

export const metadata = {
  title: "Compare — Pirol"
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ brands?: string | string[] }>;
};

/**
 * `/compare` — landing for the Competitor Analysis tab.
 *
 * Renders three stacked panels:
 *   1. Saved competitor sets the user owns (clickable into `/compare/[id]`).
 *   2. Ad-hoc brand picker.
 *   3. If `?brands=...` is set, the live comparison dashboard below.
 *
 * The picker is a client island; everything else is server-rendered so
 * the page is hydrated with real data on first paint and the brand
 * directory + saved-set previews don't require any client-side
 * round-trips.
 */
export default async function ComparePage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login?next=/compare");
  }

  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    redirect("/access-denied");
  }

  const params = await searchParams;
  const rawBrands = params.brands;
  const requestedBrandIds = dedupeBrandIds(
    typeof rawBrands === "string"
      ? rawBrands.split(",")
      : Array.isArray(rawBrands)
        ? rawBrands.flatMap((v) => v.split(","))
        : []
  ).slice(0, MAX_BRANDS_PER_COMPARISON);

  // Parallelise the three sources of data the landing needs: saved
  // sets, collections (for the sidebar), and — if we're rendering the
  // ad-hoc dashboard — the full comparison payload. Skipping the last
  // one when no brands are selected saves a fan-out of
  // `getBrandPageData` calls. The picker itself searches the brand
  // directory on demand via `/api/brands/list`, so we no longer
  // prefetch the catalogue here.
  const [sets, collections, comparison] = await Promise.all([
    listCompetitorSetSummaries(supabase, user.id),
    listCollectionSummaries(supabase, user.id),
    requestedBrandIds.length > 0
      ? getCompetitorComparison(supabase, requestedBrandIds)
      : Promise.resolve({ brands: [], missing: [] })
  ]);

  // Preview brands for each saved set — used by the grid card to show
  // 4 stacked logos. Fetched as a single bulk query so we don't fan
  // out per set; only run when the user has at least one set.
  const setPreviews: Record<string, CompetitorSetBrand[]> = {};
  if (sets.length > 0) {
    const setIds = sets.map((s) => s.id);
    const { data: previewRows } = await supabase
      .from("competitor_set_members")
      .select(
        `set_id, added_at, companies!inner(id, name, markets, logo_storage_path, deleted_at)`
      )
      .in("set_id", setIds)
      .order("added_at", { ascending: true });

    const rows = previewRows ?? [];
    const logoPaths = new Set<string>();
    for (const row of rows) {
      const company = Array.isArray(row.companies)
        ? row.companies[0]
        : row.companies;
      if (company && !company.deleted_at && company.logo_storage_path) {
        logoPaths.add(company.logo_storage_path);
      }
    }
    const signed =
      logoPaths.size > 0
        ? await getSignedAssets(Array.from(logoPaths), {
            transform: BRAND_LOGO_TRANSFORM
          })
        : {};

    for (const row of rows) {
      const company = Array.isArray(row.companies)
        ? row.companies[0]
        : row.companies;
      if (!company || company.deleted_at) continue;
      const bucket = setPreviews[row.set_id] ?? [];
      if (bucket.length >= 4) continue;
      bucket.push({
        id: company.id,
        name: company.name,
        domain: null,
        markets: Array.isArray(company.markets)
          ? (company.markets as unknown[]).filter(
              (value): value is string =>
                typeof value === "string" && value.length > 0
            )
          : [],
        logoUrl: company.logo_storage_path
          ? signed[company.logo_storage_path] ?? null
          : null
      });
      setPreviews[row.set_id] = bucket;
    }
  }

  // Seed the chip tray with whatever the comparison payload already
  // resolved so deep-linked brand chips render their logo + name on
  // first paint instead of flashing a "Loading…" placeholder.
  const initialBrandOptions = comparison.brands.map((b) => ({
    id: b.brand.id,
    name: b.brand.name,
    markets: b.brand.markets,
    logoUrl: b.brand.logoUrl
  }));

  const dashboardBrands = comparison.brands;
  const showDashboard = dashboardBrands.length > 0;

  return (
    <div className={styles.shell}>
      <ExploreSidebar
        activeId="compare"
        collections={collections}
        competitorSets={sets}
      />

      <main className={styles.main}>
        <header className={styles.heading}>
          <div>
            <h1>Compare</h1>
            <p>
              Spot patterns across a cohort of competitors — cadence, promo
              intensity, category mix, design tells, and the voice of their
              CTAs. Save groups you benchmark often.
            </p>
          </div>
        </header>

        <CompareLandingClient
          sets={sets}
          initialBrandIds={requestedBrandIds}
          initialBrandOptions={initialBrandOptions}
          setPreviews={setPreviews}
        />

        {showDashboard ? (
          <section style={{ marginTop: "2rem" }}>
            <CompareBrandStrip
              brands={dashboardBrands}
              setId={null}
              setName={`Comparing ${dashboardBrands.length} brand${
                dashboardBrands.length === 1 ? "" : "s"
              }`}
              subtitle="Ad-hoc comparison — save it as a set above to keep this group."
            />
            <CompareDashboard
              brands={dashboardBrands}
              missingIds={comparison.missing}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}
