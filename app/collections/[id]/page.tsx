import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getBrandDiscountBenchmarks,
  getCollectionForOwner,
  listCollectionSummaries,
  markCollectionViewed,
  type CollectionSummary
} from "@/lib/collections-db";
import {
  listCompetitorSetSummaries,
  type CompetitorSetSummary
} from "@/lib/competitor-db";
import { isDiscountFigureEligible } from "@/lib/collection-event-shared";
import { getExploreFacets, type ExploreFacets } from "@/lib/explore-db";
import { listSavedEmailIds } from "@/lib/saved-emails-db";
import { getViewer } from "@/lib/access";
import LockedFeature from "@/components/access/LockedFeature";
import CollectionDetailClient from "@/components/collections/CollectionDetailClient";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import { getViewerDisplay } from "@/lib/viewer-display";
import styles from "@/components/explore/explore.module.css";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type PageProps = {
  params: Promise<{ id: string }>;
};

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
  // subscribe panel instead of the collection detail.
  if (!viewer || !viewer.hasAccess) {
    return (
      <div className={styles.shell}>
        <ExploreSidebar user={await getViewerDisplay()} activeId="collections" hasAccess={false} />
        <main className={styles.main}>
          <LockedFeature variant="collections" />
        </main>
      </div>
    );
  }

  const userId = viewer.userId;

  const collection = await getCollectionForOwner(supabase, userId, id);
  if (!collection) {
    notFound();
  }

  try {
    await markCollectionViewed(supabase, userId, id);
  } catch (err) {
    console.error("Failed to mark collection viewed", err);
  }

  // Deepest discount each brand in this collection has run over the past
  // 12 months — benchmarks the campaign's cuts in the insights figure.
  // The figure only renders for a confirmed-event, discount-heavy
  // collection, so skip this whole-archive lookup otherwise rather than
  // run it on every page load and bin the result.
  // "Detected and not dismissed" rather than strictly confirmed: a user
  // confirms client-side without a reload, so this keeps the benchmark
  // ready for that first view too. Still skips non-event, dismissed, and
  // non-discount-heavy collections — i.e. almost all of them.
  let brandDiscountBenchmarks: Record<string, number> = {};
  const detection = collection.eventDetection;
  const discountFigureMayRender =
    detection?.status === "detected" &&
    detection.confirmed !== false &&
    isDiscountFigureEligible(collection.emails);
  if (discountFigureMayRender) {
    try {
      const companyIds = collection.emails
        .map((email) => email.companyId)
        .filter((value): value is string => Boolean(value));
      const since = new Date();
      since.setFullYear(since.getFullYear() - 1);
      brandDiscountBenchmarks = await getBrandDiscountBenchmarks(
        supabase,
        companyIds,
        since.toISOString()
      );
    } catch (err) {
      console.error("Failed to load brand discount benchmarks", err);
    }
  }

  // We still want the Save/Unsave bookmark state on every card so the
  // user's existing Saved list lights up here, same as on Explore.
  let savedIds: string[] = [];
  try {
    const set = await listSavedEmailIds(
      supabase,
      userId,
      collection.emails.map((email) => email.id)
    );
    savedIds = Array.from(set);
  } catch (err) {
    console.error("Failed to load saved ids for collection", err);
  }

  // Pre-load every collection this user owns so the "Add to another
  // collection" popover on each card works without an extra fetch.
  let collections: CollectionSummary[] = [];
  try {
    collections = await listCollectionSummaries(supabase, userId);
  } catch (err) {
    console.error("Failed to load collections", err);
  }

  let competitorSets: CompetitorSetSummary[] = [];
  try {
    competitorSets = await listCompetitorSetSummaries(supabase, userId);
  } catch (err) {
    console.error("Failed to load competitor sets", err);
  }

  // The rules editor needs the canonical list of brands / markets /
  // categories so its dropdowns are exhaustive — same facets the
  // Explore page uses for its own filter chips.
  let facets: ExploreFacets = {
    brands: [],
    markets: [],
    categories: [],
    countries: []
  };
  try {
    facets = await getExploreFacets(supabase);
  } catch (err) {
    console.error("Failed to load explore facets", err);
  }

  return (
    <div className={styles.shell}>
      <ExploreSidebar
        user={await getViewerDisplay()}
        activeId={`collection:${collection.id}`}
        collections={collections}
        competitorSets={competitorSets}
      />

      <main className={styles.main}>
        <CollectionDetailClient
          initialCollection={collection}
          initialSavedIds={savedIds}
          initialCollections={collections}
          facets={facets}
          brandDiscountBenchmarks={brandDiscountBenchmarks}
        />
      </main>
    </div>
  );
}
