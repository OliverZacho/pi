import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getCollectionForOwner,
  listCollectionSummaries,
  markCollectionViewed,
  type CollectionSummary
} from "@/lib/collections-db";
import {
  listCompetitorSetSummaries,
  type CompetitorSetSummary
} from "@/lib/competitor-db";
import { getExploreFacets, type ExploreFacets } from "@/lib/explore-db";
import { listSavedEmailIds } from "@/lib/saved-emails-db";
import { getViewer } from "@/lib/access";
import LockedFeature from "@/components/access/LockedFeature";
import CollectionDetailClient from "@/components/collections/CollectionDetailClient";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
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
        <ExploreSidebar activeId="collections" hasAccess={false} />
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
  let facets: ExploreFacets = { brands: [], markets: [], categories: [] };
  try {
    facets = await getExploreFacets(supabase);
  } catch (err) {
    console.error("Failed to load explore facets", err);
  }

  return (
    <div className={styles.shell}>
      <ExploreSidebar
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
        />
      </main>
    </div>
  );
}
