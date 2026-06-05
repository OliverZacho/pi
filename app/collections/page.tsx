import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
import styles from "@/components/explore/explore.module.css";

export const metadata = {
  title: "Collections — Pirol"
};

export default async function CollectionsPage() {
  // Admin gate matches `/explore` and `/saved` — the per-card preview
  // iframes still hit `/api/admin/emails/[id]/render`. When we expose
  // Pirol more broadly we'll route preview iframes through a public
  // endpoint instead.
  const supabase = await createClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login?next=/collections");
  }

  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    redirect("/access-denied");
  }

  const items = await listCollectionsWithPreviews(supabase, user.id);
  // Sidebar summaries include the "new emails" dot flag for rule-based
  // collections; the grid still uses the richer preview payload above.
  let sidebarCollections: CollectionSummary[] = [];
  try {
    sidebarCollections = await listCollectionSummaries(supabase, user.id);
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
    sidebarSets = await listCompetitorSetSummaries(supabase, user.id);
  } catch (err) {
    console.error("Failed to load competitor sets", err);
  }

  return (
    <div className={styles.shell}>
      <ExploreSidebar
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
