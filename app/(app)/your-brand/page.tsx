import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/access";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getBrandPageData, type BrandPageData } from "@/lib/brand-db";
import { brandUrlLabel } from "@/lib/brand-url";
import {
  getCompetitorComparison,
  getCompetitorSetForReader,
  listCompetitorSetSummaries,
  MAX_BRANDS_PER_COMPARISON
} from "@/lib/competitor-db";
import {
  getDeliverabilitySample,
  getYourBrandBySlug,
  getYourBrandMatch,
  getYourBrandPrefs,
  type YourBrandMatch
} from "@/lib/your-brand-db";
import { buildYourBrandInsights } from "@/lib/your-brand-insights";
import LockedFeature from "@/components/access/LockedFeature";
import RequestBrandButton from "@/components/your-brand/RequestBrandButton";
import YourBrandDashboard from "@/components/your-brand/YourBrandDashboard";
import styles from "@/components/your-brand/your-brand.module.css";

export const metadata = {
  title: "Your brand — Pirol"
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ brand?: string }>;
};

/**
 * `/your-brand` — insights into the viewer's own email program.
 *
 * The page exists for users whose login-email domain matches a tracked
 * brand's website domain (xxx@fermliving.com → fermliving.com). Paid
 * viewers get the full insight cards; unpaid viewers with a match get a
 * teaser that names how many checks fired; everyone else gets an
 * explainer or the standard locked panel. The sidebar only shows the tab
 * when a match exists, but the page handles every state so a direct URL
 * visit never breaks.
 *
 * Admins can append `?brand=<slug>` to run the page against any tracked
 * brand — the founder's login is a consumer domain, so without the
 * override the page would be untestable in production.
 */
export default async function YourBrandPage({ searchParams }: PageProps) {
  const viewer = await getViewer();

  if (!viewer) {
    return (
      <main className={styles.main}>
        <LockedFeature variant="your-brand" />
      </main>
    );
  }

  const params = await searchParams;
  let match: YourBrandMatch | null = null;
  if (viewer.isAdmin && params.brand) {
    match = await getYourBrandBySlug(params.brand);
  }
  if (!match) {
    match = await getYourBrandMatch(viewer.email);
  }

  if (!match) {
    return (
      <main className={styles.main}>
        <header className={styles.heading}>
          <div>
            <h1>Your brand</h1>
            <p>
              A running check of your own email program, built from the
              emails we capture.
            </p>
          </div>
        </header>
        <section className={styles.section}>
          <div className={styles.sectionEyebrow}>No brand matched</div>
          <h2 className={styles.sectionTitle}>
            We couldn&apos;t match your email to a tracked brand
          </h2>
          <p className={styles.sectionSub}>
            This tab activates when your login email&apos;s domain matches
            the website of a brand we track. You are signed in as{" "}
            {viewer.email ?? "an account without an email"}, and we
            don&apos;t track a brand on that domain yet. If you work at a
            brand, request it below and sign in with your work email.
          </p>
          <div className={styles.noMatchActions}>
            <RequestBrandButton />
          </div>
        </section>
      </main>
    );
  }

  // Unpaid viewers with a real match: run the self-contained checks with
  // the service-role client (read-only) so the teaser can say how many
  // fired, without rendering any of the underlying findings.
  if (!viewer.hasAccess) {
    const admin = getSupabaseAdmin();
    const [own, deliverability] = await Promise.all([
      getBrandPageData(admin, match.id),
      getDeliverabilitySample(admin, match.id)
    ]);
    const count = own
      ? buildYourBrandInsights({ own, peers: [], deliverability }).length
      : 0;

    return (
      <main className={styles.main}>
        <LockedFeature
          variant="your-brand"
          title={`See what ${match.name} could do better`}
          description={
            count > 0
              ? `We matched your email to ${match.name} and ran its captured emails through our deliverability, design and timing checks. ${count} check${count === 1 ? "" : "s"} flagged something worth changing right now. Subscribe to see what, and to compare against the competitors you pick.`
              : `We matched your email to ${match.name}. Subscribe to run its captured emails through our deliverability, design and timing checks, and to compare against the competitors you pick.`
          }
        />
      </main>
    );
  }

  const supabase = await createClient();
  const [own, deliverability, prefs, comparisonSets] = await Promise.all([
    getBrandPageData(supabase, match.id),
    getDeliverabilitySample(supabase, match.id),
    getYourBrandPrefs(supabase, viewer.userId),
    listCompetitorSetSummaries(supabase, viewer.userId).catch((err) => {
      console.error("Failed to load comparisons for your-brand", err);
      return [];
    })
  ]);

  if (!own) {
    // Matched company vanished between the sidebar check and this render
    // (deleted / no longer tracked) — the explainer is the honest state.
    return (
      <main className={styles.main}>
        <header className={styles.heading}>
          <div>
            <h1>Your brand</h1>
          </div>
        </header>
        <section className={styles.section}>
          <p className={styles.empty}>
            {match.name} is not tracked right now. Check back soon.
          </p>
        </section>
      </main>
    );
  }

  // Peer group: the brands of the user's chosen comparison, minus their
  // own brand. A deleted or emptied set degrades to "no peers" and the
  // peer-based rules simply stay silent.
  let peers: BrandPageData[] = [];
  let selectedSetId: string | null = null;
  if (prefs.competitorSetId) {
    const set = await getCompetitorSetForReader(
      supabase,
      prefs.competitorSetId
    ).catch(() => null);
    if (set) {
      selectedSetId = set.id;
      const memberIds = set.brands
        .map((brand) => brand.id)
        .filter((id) => id !== match.id)
        .slice(0, MAX_BRANDS_PER_COMPARISON);
      if (memberIds.length > 0) {
        const comparison = await getCompetitorComparison(supabase, memberIds);
        peers = comparison.brands;
      }
    }
  }

  const insights = buildYourBrandInsights({ own, peers, deliverability });

  return (
    <main className={styles.main}>
      <header className={styles.heading}>
        <div>
          <h1>Your brand</h1>
          <p>
            A running check of your own email program, built from the
            emails we capture from {match.name}. Each card is something the
            data says you could change, with the numbers behind it.
          </p>
          <div className={styles.brandLine}>
            <span className={styles.brandChip}>{match.name}</span>
            <span>matched via @{brandUrlLabel(match.domain)}</span>
            <Link href={`/brands/${match.slug}`} className={styles.brandLink}>
              Open the {match.name} brand dashboard
            </Link>
          </div>
        </div>
      </header>

      <YourBrandDashboard
        insights={insights}
        initialDismissed={prefs.dismissed}
        comparisonOptions={comparisonSets.map((set) => ({
          id: set.id,
          name: set.name,
          brandCount: set.brandCount
        }))}
        selectedSetId={selectedSetId}
        peerCount={peers.length}
      />
    </main>
  );
}
