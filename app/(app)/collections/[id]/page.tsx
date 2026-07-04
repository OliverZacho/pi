import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { DEMO_COLLECTION_ID } from "@/lib/demo";
import {
  getBrandDiscountBenchmarks,
  getCollectionForOwner,
  getCollectionForReader,
  listCollectionSummaries,
  markCollectionViewed,
  type CollectionSummary
} from "@/lib/collections-db";
import { isDiscountFigureEligible } from "@/lib/collection-event-shared";
import { getExploreFacets, type ExploreFacets } from "@/lib/explore-db";
import { listFollowedBrandIds } from "@/lib/follows-db";
import { listSavedEmailIds } from "@/lib/saved-emails-db";
import { hasActiveTeamPlan } from "@/lib/teams-db";
import { getViewer } from "@/lib/access";
import LockedFeature from "@/components/access/LockedFeature";
import CollectionDetailClient from "@/components/collections/CollectionDetailClient";
import styles from "@/components/explore/explore.module.css";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type PageProps = {
  params: Promise<{ id: string }>;
};

/**
 * The onboarding tour's demo collection, rendered read-only via the
 * service-role client (past RLS). Served to unpaid users in place of the
 * locked upsell, and to paid users who don't own it (invited team members
 * on the tour). Null when the seeded row is missing.
 */
async function demoCollectionView() {
  const admin = getSupabaseAdmin();
  const demoCollection = await getCollectionForReader(admin, DEMO_COLLECTION_ID);
  if (!demoCollection) {
    return null;
  }
  const demoFacets = await getExploreFacets(admin).catch(() => ({
    brands: [],
    markets: [],
    categories: [],
    countries: []
  }));
  return (
    <main className={styles.main} data-tour="collection-demo">
      <CollectionDetailClient
        initialCollection={demoCollection}
        initialSavedIds={[]}
        initialCollections={[]}
        facets={demoFacets}
        brandDiscountBenchmarks={{}}
        followedCompanyIds={[]}
        canEdit={false}
        canShareWithTeam={false}
      />
    </main>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return {
    title: `Collection — Pirol`,
    description: `View collection ${id}`
  };
}

export default async function CollectionDetailPage({ params }: PageProps) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const supabase = await createClient();
  const viewer = await getViewer();

  // Collections is a paid feature — public (non-admin) users get a
  // subscribe panel instead of the collection detail. The one exception is the
  // onboarding tour's demo collection: unpaid users get its real detail view
  // (fetched service-side past RLS), read-only (`canEdit=false`).
  if (!viewer || !viewer.hasAccess) {
    if (id === DEMO_COLLECTION_ID) {
      const demo = await demoCollectionView();
      if (demo) return demo;
    }
    return (
      <main className={styles.main}>
        <LockedFeature variant="collections" />
      </main>
    );
  }

  const userId = viewer.userId;

  // Owner path first; fall back to the team-reader path (RLS lets a
  // co-member read a collection shared with their team).
  let collection = await getCollectionForOwner(supabase, userId, id);
  if (!collection) {
    collection = await getCollectionForReader(supabase, id);
  }
  if (!collection) {
    // Paid viewers who don't own the tour's demo collection (e.g. an invited
    // team member walking the tour) would otherwise 404 here — RLS doesn't
    // share it. Give them the same read-only demo view unpaid users get.
    if (id === DEMO_COLLECTION_ID) {
      const demo = await demoCollectionView();
      if (demo) return demo;
    }
    notFound();
  }

  const canEdit = collection.ownerId === userId;

  // Everything below depends only on `collection` (already resolved) and is
  // otherwise independent, so fan it all out in one parallel batch rather
  // than a chain of awaits — each was a separate serial DB round-trip.
  const companyIds = Array.from(
    new Set(
      collection.emails
        .map((email) => email.companyId)
        .filter((value): value is string => Boolean(value))
    )
  );
  const emailIds = collection.emails.map((email) => email.id);

  // Deepest discount each brand has run over the past 12 months — benchmarks
  // the campaign's cuts in the insights figure. Only runs for a
  // confirmed-event, discount-heavy collection ("detected and not
  // dismissed", so it's ready on the first client-side confirm too); skipped
  // for the ~all other collections rather than run and binned.
  const detection = collection.eventDetection;
  const discountFigureMayRender =
    detection?.status === "detected" &&
    detection.confirmed !== false &&
    isDiscountFigureEligible(collection.emails);
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);

  const [
    ,
    brandDiscountBenchmarks,
    followedSet,
    savedSet,
    collections,
    facets,
    canShareWithTeam
  ] = await Promise.all([
    // Fire-and-forget view marker; owners only.
    canEdit
      ? markCollectionViewed(supabase, userId, id).catch((err) => {
          console.error("Failed to mark collection viewed", err);
          return null;
        })
      : Promise.resolve(null),
    discountFigureMayRender
      ? getBrandDiscountBenchmarks(
          supabase,
          companyIds,
          since.toISOString()
        ).catch((err) => {
          console.error("Failed to load brand discount benchmarks", err);
          return {} as Record<string, number>;
        })
      : Promise.resolve({} as Record<string, number>),
    // Which collection brands the user follows — scoped to the collection's
    // companies so we never pull their whole follow list.
    companyIds.length > 0
      ? listFollowedBrandIds(supabase, userId, companyIds).catch((err) => {
          console.error("Failed to load followed brands for collection", err);
          return new Set<string>();
        })
      : Promise.resolve(new Set<string>()),
    // Save/Unsave bookmark state for every card, same as Explore.
    listSavedEmailIds(supabase, userId, emailIds).catch((err) => {
      console.error("Failed to load saved ids for collection", err);
      return new Set<string>();
    }),
    // Every collection the user owns, for the "Add to another collection"
    // popover on each card.
    listCollectionSummaries(supabase, userId).catch((err) => {
      console.error("Failed to load collections", err);
      return [] as CollectionSummary[];
    }),
    // Canonical brands / markets / categories for the rules editor dropdowns.
    getExploreFacets(supabase).catch((err) => {
      console.error("Failed to load explore facets", err);
      return {
        brands: [],
        markets: [],
        categories: [],
        countries: []
      } as ExploreFacets;
    }),
    // Team sharing is a Team-plan feature. Owners without it still see the
    // button — rendered as a locked upsell — so resolve entitlement here.
    // Admins always pass; otherwise it's an active "team" subscription.
    canEdit
      ? viewer.isAdmin
        ? Promise.resolve(true)
        : hasActiveTeamPlan(supabase, userId).catch((err) => {
            console.error("Failed to check team plan for collection", err);
            return false;
          })
      : Promise.resolve(false)
  ]);

  const followedCompanyIds = Array.from(followedSet);
  const savedIds = Array.from(savedSet);

  return (
    <main className={styles.main}>
      <CollectionDetailClient
        initialCollection={collection}
        initialSavedIds={savedIds}
        initialCollections={collections}
        facets={facets}
        brandDiscountBenchmarks={brandDiscountBenchmarks}
        followedCompanyIds={followedCompanyIds}
        canEdit={canEdit}
        canShareWithTeam={canShareWithTeam}
      />
    </main>
  );
}
