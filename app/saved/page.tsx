import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { FREE_SAVE_LIMIT, getViewer } from "@/lib/access";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import LockedFeature from "@/components/access/LockedFeature";
import { countSavedEmails, listSavedEmails } from "@/lib/saved-emails-db";
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

  // Logged-out visitors can't save anything, so they get the subscribe
  // panel instead of an always-empty gallery.
  if (!viewer) {
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

  // Signed-in but unpaid: show their free saves (read via the
  // service-role client since their session token has no RLS grant on
  // saved_emails), with an upgrade nudge. The gallery renders through the
  // link-stripped public endpoints. Collections stay paid.
  if (!viewer.hasAccess) {
    const admin = getSupabaseAdmin();
    let items: Awaited<ReturnType<typeof listSavedEmails>>["items"] = [];
    let savedCount = 0;
    try {
      const [result, count] = await Promise.all([
        listSavedEmails(admin, userId),
        countSavedEmails(admin, userId)
      ]);
      items = result.items;
      savedCount = count;
    } catch (err) {
      console.error("Failed to load saved emails", err);
    }

    return (
      <div className={styles.shell}>
        <ExploreSidebar activeId="saved" hasAccess={false} />
        <main className={styles.main}>
          <header className={styles.heading}>
            <h1>Saved</h1>
            <p>
              {savedCount === 0
                ? "Save emails from Explore and they'll show up here."
                : `${savedCount} of ${FREE_SAVE_LIMIT} free saves used.`}
            </p>
          </header>

          <div className={styles.saveQuota}>
            <span className={styles.saveQuotaText}>
              {savedCount >= FREE_SAVE_LIMIT
                ? `You've used all ${FREE_SAVE_LIMIT} free saves.`
                : `Free accounts can save up to ${FREE_SAVE_LIMIT} emails.`}{" "}
              Upgrade for unlimited saving, collections, and the full archive.
            </span>
            <Link href="/pricing" className={styles.saveQuotaCta}>
              View plans
            </Link>
          </div>

          <SavedGalleryClient
            initialEmails={items}
            initialCollections={[]}
            publicView
          />
        </main>
      </div>
    );
  }

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
