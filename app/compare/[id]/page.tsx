import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getCompetitorComparison,
  getCompetitorSetForOwner,
  listCompetitorSetSummaries
} from "@/lib/competitor-db";
import { listCollectionSummaries } from "@/lib/collections-db";
import { getViewer } from "@/lib/access";
import LockedFeature from "@/components/access/LockedFeature";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import { getViewerDisplay } from "@/lib/viewer-display";
import CompareBrandStrip from "@/components/compare/CompareBrandStrip";
import CompareDashboard from "@/components/compare/CompareDashboard";
import styles from "@/components/compare/compare.module.css";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

/**
 * `/compare/[id]` — saved comparison dashboard.
 *
 * Resolves the set (owner-scoped), loads each member brand's full
 * `BrandPageData` in parallel, and renders the same dashboard as the
 * ad-hoc compare flow. The header is a client island that owns
 * rename / delete / "remove brand" actions; the dashboard itself stays
 * server-rendered.
 */
export default async function CompareSetPage({ params }: PageProps) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const supabase = await createClient();
  const viewer = await getViewer();
  // Compare is a paid feature — public (non-admin) users get a subscribe
  // panel instead of the saved-set dashboard.
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

  const set = await getCompetitorSetForOwner(supabase, userId, id);
  if (!set) {
    notFound();
  }

  const [collections, sidebarSets, comparison] = await Promise.all([
    listCollectionSummaries(supabase, userId),
    listCompetitorSetSummaries(supabase, userId),
    getCompetitorComparison(
      supabase,
      set.brands.map((b) => b.id)
    )
  ]);

  const subtitle = `${set.brands.length} brand${
    set.brands.length === 1 ? "" : "s"
  } · Updated ${formatRelativeDate(set.updatedAt)}`;

  return (
    <div className={styles.shell}>
      <ExploreSidebar
        user={await getViewerDisplay()}
        activeId={`compare:${set.id}`}
        collections={collections}
        competitorSets={sidebarSets}
      />

      <main className={styles.main}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <Link href="/compare" className={styles.breadcrumbLink}>
            <span aria-hidden="true">‹</span>
            <span>Comparisons</span>
          </Link>
          <span className={styles.breadcrumbSep}>/</span>
          <span className={styles.breadcrumbCurrent}>{set.name}</span>
        </nav>

        <CompareBrandStrip
          brands={comparison.brands}
          setId={set.id}
          setName={set.name}
          subtitle={subtitle}
        />

        {set.brands.length === 0 ? (
          <section className={styles.section}>
            <span className={styles.sectionEyebrow}>Empty comparison</span>
            <h2 className={styles.sectionTitle}>No brands here yet</h2>
            <p className={styles.sectionSub}>
              Select brands on the <Link href="/brands">Brands page</Link> and
              choose <em>Add to…</em>, or use the picker on the{" "}
              <Link href="/compare">Comparisons landing</Link>.
            </p>
          </section>
        ) : (
          <CompareDashboard
            brands={comparison.brands}
            missingIds={comparison.missing}
          />
        )}
      </main>
    </div>
  );
}

function formatRelativeDate(value: string): string {
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return "—";
  const now = Date.now();
  const diff = now - ts.getTime();
  const day = 86_400_000;
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  if (diff < 7 * day) return `${Math.round(diff / day)}d ago`;
  if (diff < 30 * day) return `${Math.round(diff / (7 * day))}w ago`;
  return ts.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
