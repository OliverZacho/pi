import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { DEMO_COMPARISON_ID } from "@/lib/demo";
import {
  getCompetitorComparison,
  getCompetitorSetForOwner,
  getCompetitorSetForReader
} from "@/lib/competitor-db";
import { getCompareSectionPrefs } from "@/lib/user-prefs-db";
import { hasActiveTeamPlan } from "@/lib/teams-db";
import { getViewer } from "@/lib/access";
import LockedFeature from "@/components/access/LockedFeature";
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
 * The onboarding tour's demo comparison, rendered read-only via the
 * service-role client (past RLS). Served to unpaid users in place of the
 * locked upsell, and to paid users who don't own it (invited team members
 * on the tour). Null when the seeded row is missing or empty.
 */
async function demoComparisonView() {
  const admin = getSupabaseAdmin();
  const demoSet = await getCompetitorSetForReader(admin, DEMO_COMPARISON_ID);
  if (!demoSet || demoSet.brands.length === 0) {
    return null;
  }
  const demoComparison = await getCompetitorComparison(
    admin,
    demoSet.brands.map((b) => ({ companyId: b.id, inboxIds: b.inboxIds }))
  );
  return (
    <main className={styles.main} data-tour="compare-demo">
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/compare" className={styles.breadcrumbLink}>
          <span aria-hidden="true">‹</span>
          <span>Comparisons</span>
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>{demoSet.name}</span>
      </nav>

      <CompareBrandStrip
        brands={demoComparison.brands}
        setId={demoSet.id}
        setName={demoSet.name}
        subtitle={`${demoSet.brands.length} brands · Demo comparison`}
        canEdit={false}
        sharedWithTeam={demoSet.sharedWithTeam}
        canShareWithTeam={false}
      />

      <CompareDashboard
        brands={demoComparison.brands}
        missingIds={demoComparison.missing}
      />
    </main>
  );
}

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
  // panel instead of the saved-set dashboard. The one exception is the
  // onboarding tour's demo comparison: unpaid users get its real dashboard
  // (fetched service-side past RLS), read-only (`canEdit=false`).
  if (!viewer || !viewer.hasAccess) {
    if (id === DEMO_COMPARISON_ID) {
      const demo = await demoComparisonView();
      if (demo) return demo;
    }
    return (
      <main className={styles.main}>
        <LockedFeature variant="compare" />
      </main>
    );
  }

  const userId = viewer.userId;

  // Owner path first; fall back to the team-reader path (RLS lets a
  // co-member read a comparison shared with their team).
  let set = await getCompetitorSetForOwner(supabase, userId, id);
  if (!set) {
    set = await getCompetitorSetForReader(supabase, id);
  }
  if (!set) {
    // Paid viewers who don't own the tour's demo comparison (e.g. an invited
    // team member walking the tour) would otherwise 404 here — RLS doesn't
    // share it. Give them the same read-only demo view unpaid users get.
    if (id === DEMO_COMPARISON_ID) {
      const demo = await demoComparisonView();
      if (demo) return demo;
    }
    notFound();
  }

  const canEdit = set.ownerId === userId;

  const [comparison, sectionPrefs, canShareWithTeam] = await Promise.all([
    getCompetitorComparison(
      supabase,
      set.brands.map((b) => ({ companyId: b.id, inboxIds: b.inboxIds }))
    ),
    getCompareSectionPrefs(supabase, userId),
    // Team sharing is a Team-plan feature. Owners without it still see the
    // button — rendered as a locked upsell — so resolve entitlement here.
    // Admins always pass; otherwise it's an active "team" subscription.
    canEdit
      ? viewer.isAdmin
        ? Promise.resolve(true)
        : hasActiveTeamPlan(supabase, userId).catch((err) => {
            console.error("Failed to check team plan for comparison", err);
            return false;
          })
      : Promise.resolve(false)
  ]);

  const subtitle = `${set.brands.length} brand${
    set.brands.length === 1 ? "" : "s"
  } · Updated ${formatRelativeDate(set.updatedAt)}`;

  return (
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
        canEdit={canEdit}
        sharedWithTeam={set.sharedWithTeam}
        canShareWithTeam={canShareWithTeam}
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
          sectionPrefs={sectionPrefs}
        />
      )}
    </main>
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
