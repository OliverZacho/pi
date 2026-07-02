import { createClient } from "@/lib/supabase/server";
import {
  dedupeBrandIds,
  getCompetitorComparison,
  getComparisonActivity,
  listCompetitorSetSummaries,
  listTeamSharedSets,
  MAX_BRANDS_PER_COMPARISON,
  type ComparisonActivity,
  type CompetitorSetBrand,
  type TeamSharedSet
} from "@/lib/competitor-db";
import { listCollectionSummaries } from "@/lib/collections-db";
import { getCompareSectionPrefs } from "@/lib/user-prefs-db";
import { getViewer } from "@/lib/access";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import LockedFeature from "@/components/access/LockedFeature";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import { getViewerDisplay } from "@/lib/viewer-display";
import CompareBrandStrip from "@/components/compare/CompareBrandStrip";
import CompareDashboard from "@/components/compare/CompareDashboard";
import CompareLandingClient from "@/components/compare/CompareLandingClient";
import TeamSharedCard from "@/components/team/TeamSharedCard";
import styles from "@/components/compare/compare.module.css";
import shared from "@/components/team/team-shared.module.css";
import { BRAND_LOGO_TRANSFORM, getSignedAssets } from "@/lib/storage";

export const metadata = {
  title: "Comparisons — Pirol"
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ brands?: string | string[] }>;
};

/**
 * `/compare` — landing for the Comparisons tab.
 *
 * Renders three stacked panels:
 *   1. Saved comparisons the user owns (clickable into `/compare/[id]`).
 *   2. Ad-hoc brand picker (secondary — the primary creation path is
 *      selecting brands on the Brands page).
 *   3. If `?brands=...` is set, the live comparison dashboard below.
 *
 * The picker is a client island; everything else is server-rendered so
 * the page is hydrated with real data on first paint and the brand
 * directory + saved-set previews don't require any client-side
 * round-trips.
 */
export default async function ComparePage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const viewer = await getViewer();

  // Compare is a paid feature — public (non-admin) users get a subscribe
  // panel instead of the comparison tools.
  if (!viewer || !viewer.hasAccess) {
    return (
      <div className={styles.shell}>
        <ExploreSidebar user={await getViewerDisplay()} activeId="compare" hasAccess={false} />
        <main className={styles.main}>
          <LockedFeature variant="compare" />
        </main>
      </div>
    );
  }

  const userId = viewer.userId;

  const params = await searchParams;
  const rawBrands = params.brands;
  const requestedBrandIds = dedupeBrandIds(
    typeof rawBrands === "string"
      ? rawBrands.split(",")
      : Array.isArray(rawBrands)
        ? rawBrands.flatMap((v) => v.split(","))
        : []
  ).slice(0, MAX_BRANDS_PER_COMPARISON);

  // Parallelise everything the landing needs that doesn't depend on
  // another result: saved sets, collections (sidebar), the full comparison
  // payload (only when brands are deep-linked — otherwise we skip the
  // `getBrandPageData` fan-out), section prefs, the team-shared list, and
  // the viewer display row. The picker searches the brand directory on
  // demand via `/api/brands/list`, so we no longer prefetch the catalogue.
  // `teamShared` swallows its own error so a missing table can't break the
  // page. (`setPreviews`/`setActivity` below still run after this batch —
  // they depend on the resolved `sets`.)
  const [sets, collections, comparison, sectionPrefs, teamShared, viewerDisplay] =
    await Promise.all([
      listCompetitorSetSummaries(supabase, userId),
      listCollectionSummaries(supabase, userId),
      requestedBrandIds.length > 0
        ? getCompetitorComparison(supabase, requestedBrandIds)
        : Promise.resolve({ brands: [], missing: [] }),
      getCompareSectionPrefs(supabase, userId),
      listTeamSharedSets(supabase, getSupabaseAdmin(), userId).catch((err) => {
        console.error("Failed to load team-shared comparisons", err);
        return [] as TeamSharedSet[];
      }),
      getViewerDisplay()
    ]);

  // Preview brands for each saved set — used by the grid card to show
  // 4 stacked logos. Fetched as a single bulk query so we don't fan
  // out per set; only run when the user has at least one set. The
  // 7-day activity chips ride the same guard.
  const setPreviews: Record<string, CompetitorSetBrand[]> = {};
  let setActivity: Record<string, ComparisonActivity> = {};
  if (sets.length > 0) {
    const setIds = sets.map((s) => s.id);
    // Activity chips and preview logos both key off setIds only — fetch
    // them together rather than serially.
    const [activity, { data: previewRows }] = await Promise.all([
      getComparisonActivity(supabase, setIds).catch((err) => {
        console.error("Failed to load comparison activity", err);
        return {} as Record<string, ComparisonActivity>;
      }),
      supabase
        .from("competitor_set_members")
        .select(
          `set_id, added_at, companies!inner(id, name, markets, logo_storage_path, deleted_at)`
        )
        .in("set_id", setIds)
        .order("added_at", { ascending: true })
    ]);
    setActivity = activity;

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
          : null,
        // Card previews only render logos; list scope is irrelevant here.
        inboxIds: []
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
    primaryMarketCountry: b.brand.primaryMarketCountry,
    isGlobal: b.brand.isGlobal,
    logoUrl: b.brand.logoUrl
  }));

  const dashboardBrands = comparison.brands;
  const showDashboard = dashboardBrands.length > 0;

  return (
    <div className={styles.shell}>
      <ExploreSidebar
        user={viewerDisplay}
        activeId="compare"
        collections={collections}
        competitorSets={sets}
      />

      <main className={styles.main}>
        <header className={styles.heading}>
          <div>
            <h1>Comparisons</h1>
            <p>
              Put a group of brands side by side — cadence, promo intensity,
              category mix, design tells, and the voice of their CTAs. Select
              brands on the Brands page and save the groups you revisit.
            </p>
          </div>
        </header>

        <CompareLandingClient
          sets={sets}
          initialBrandIds={requestedBrandIds}
          initialBrandOptions={initialBrandOptions}
          setPreviews={setPreviews}
          setActivity={setActivity}
        />

        {showDashboard ? (
          <section style={{ marginTop: "2rem" }}>
            <CompareBrandStrip
              brands={dashboardBrands}
              setId={null}
              setName={`Comparing ${dashboardBrands.length} brand${
                dashboardBrands.length === 1 ? "" : "s"
              }`}
              subtitle="Ad-hoc comparison — save it above to keep this group."
            />
            <CompareDashboard
              brands={dashboardBrands}
              missingIds={comparison.missing}
              sectionPrefs={sectionPrefs}
            />
          </section>
        ) : null}

        {teamShared.length > 0 ? (
          <section className={shared.section}>
            <h2 className={shared.title}>Shared with your team</h2>
            <p className={shared.subtitle}>
              Comparisons teammates have shared. You can view and copy them.
            </p>
            <div className={shared.grid}>
              {teamShared.map((s) => (
                <TeamSharedCard
                  key={s.id}
                  type="comparison"
                  id={s.id}
                  href={`/compare/${s.id}`}
                  name={s.name}
                  meta={`${s.brandCount} brand${
                    s.brandCount === 1 ? "" : "s"
                  } · Shared by ${s.ownerName ?? "a teammate"}`}
                />
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
