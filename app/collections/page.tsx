import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/access";
import LockedFeature from "@/components/access/LockedFeature";
import {
  listCollectionSummaries,
  listCollectionsWithPreviews,
  type CollectionSummary
} from "@/lib/collections-db";
import {
  listCompetitorSetSummaries,
  type CompetitorSetSummary
} from "@/lib/competitor-db";
import CollectionsGridClient from "@/components/collections/CollectionsGridClient";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import { getViewerDisplay } from "@/lib/viewer-display";
import styles from "@/components/explore/explore.module.css";

export const metadata = {
  title: "Collections — Pirol"
};

export default async function CollectionsPage() {
  const supabase = await createClient();
  const viewer = await getViewer();

  // Collections is a paid feature — public (non-admin) users see a
  // subscribe panel instead of (their non-existent) collections.
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

  const items = await listCollectionsWithPreviews(supabase, userId);
  // Sidebar summaries include the "new emails" dot flag for rule-based
  // collections; the grid still uses the richer preview payload above.
  let sidebarCollections: CollectionSummary[] = [];
  try {
    sidebarCollections = await listCollectionSummaries(supabase, userId);
  } catch (err) {
    console.error("Failed to load collection summaries", err);
    sidebarCollections = items.map((item) => ({
      id: item.id,
      name: item.name,
      icon: item.icon,
      shareSlug: item.shareSlug
    }));
  }

  let sidebarSets: CompetitorSetSummary[] = [];
  try {
    sidebarSets = await listCompetitorSetSummaries(supabase, userId);
  } catch (err) {
    console.error("Failed to load competitor sets", err);
  }

  return (
    <div className={styles.shell}>
      <ExploreSidebar
        user={await getViewerDisplay()}
        activeId="collections"
        collections={sidebarCollections}
        competitorSets={sidebarSets}
      />

      <main className={styles.main}>
        <header className={styles.heading}>
          <h1>Collections</h1>
          <p>
            {items.length === 0
              ? "Group emails into themed collections and share them with a link."
              : `${items.length} ${
                  items.length === 1 ? "collection" : "collections"
                }.`}
          </p>
        </header>

        <CollectionsGridClient initialCollections={items} />
      </main>
    </div>
  );
}
