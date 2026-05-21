import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getCompetitorComparison,
  getCompetitorSetForOwner,
  listCompetitorSetSummaries
} from "@/lib/competitor-db";
import { listCollectionSummaries } from "@/lib/collections-db";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
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
 * `/compare/[id]` — saved competitor set dashboard.
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
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect(`/login?next=/compare/${id}`);
  }

  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (adminError || !adminRow) {
    redirect("/access-denied");
  }

  const set = await getCompetitorSetForOwner(supabase, user.id, id);
  if (!set) {
    notFound();
  }

  const [collections, sidebarSets, comparison] = await Promise.all([
    listCollectionSummaries(supabase, user.id),
    listCompetitorSetSummaries(supabase, user.id),
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
        activeId={`compare:${set.id}`}
        collections={collections}
        competitorSets={sidebarSets}
      />

      <main className={styles.main}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <Link href="/compare" className={styles.breadcrumbLink}>
            <span aria-hidden="true">‹</span>
            <span>Compare</span>
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
            <span className={styles.sectionEyebrow}>Empty set</span>
            <h2 className={styles.sectionTitle}>No brands here yet</h2>
            <p className={styles.sectionSub}>
              Add brands from the picker on the{" "}
              <Link href="/compare">Compare landing</Link> or by visiting the
              Brands page in select mode.
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
