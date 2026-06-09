import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/access";
import LockedFeature from "@/components/access/LockedFeature";
import { listSavedEmails } from "@/lib/saved-emails-db";
import {
  listCollectionSummaries,
  type CollectionSummary
} from "@/lib/collections-db";
import {
  listCompetitorSetSummaries,
  type CompetitorSetSummary
} from "@/lib/competitor-db";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import SavedGalleryClient from "@/components/explore/SavedGalleryClient";
import styles from "@/components/explore/explore.module.css";

export const metadata = {
  title: "Saved — Pirol"
};

export default async function SavedPage() {
  const supabase = await createClient();
  const viewer = await getViewer();

  // Saving requires the full archive (admin-only under RLS) and the Save
  // action, neither of which the public preview exposes — so public users
  // get a subscribe panel instead of an always-empty gallery.
  if (!viewer || !viewer.hasAccess) {
    return (
      <div className={styles.shell}>
        <ExploreSidebar activeId="saved" hasAccess={false} />
        <main className={styles.main}>
          <LockedFeature variant="saved" />
        </main>
      </div>
    );
  }

  const userId = viewer.userId;

  const { items, total } = await listSavedEmails(supabase, userId);

  let initialCollections: CollectionSummary[] = [];
  try {
    initialCollections = await listCollectionSummaries(supabase, userId);
  } catch (err) {
    console.error("Failed to load collections", err);
  }

  let initialCompetitorSets: CompetitorSetSummary[] = [];
  try {
    initialCompetitorSets = await listCompetitorSetSummaries(
      supabase,
      userId
    );
  } catch (err) {
    console.error("Failed to load competitor sets", err);
  }

  return (
    <div className={styles.shell}>
      <ExploreSidebar
        activeId="saved"
        collections={initialCollections}
        competitorSets={initialCompetitorSets}
      />

      <main className={styles.main}>
        <header className={styles.heading}>
          <h1>Saved</h1>
          <p>
            {total === 0
              ? "Bookmarked emails will show up here."
              : `${total} saved ${total === 1 ? "email" : "emails"}.`}
          </p>
        </header>

        <SavedGalleryClient
          initialEmails={items}
          initialCollections={initialCollections}
        />
      </main>
    </div>
  );
}
