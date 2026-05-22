import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  EXPLORE_PAGE_SIZE,
  getExploreFacets,
  searchExploreEmails
} from "@/lib/explore-db";
import { listSavedEmailIds } from "@/lib/saved-emails-db";
import {
  listCollectionSummaries,
  type CollectionSummary
} from "@/lib/collections-db";
import {
  listCompetitorSetSummaries,
  type CompetitorSetSummary
} from "@/lib/competitor-db";
import ExploreClient from "@/components/explore/ExploreClient";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import styles from "@/components/explore/explore.module.css";

export const metadata = {
  title: "Explore — Pirol"
};

export default async function ExplorePage() {
  // The render endpoint that powers each card iframe is admin-only, so the
  // page itself enforces the same gate. When we later expose Explore to
  // non-admin users, swap this for a public render endpoint (or pre-generated
  // thumbnails) and drop the redirect.
  const supabase = await createClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login?next=/explore");
  }

  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    redirect("/access-denied");
  }

  // Server-render the first page + facets so the grid is hydrated with
  // real data on first paint. The client takes over for subsequent
  // filtering / search / infinite scroll via the `/api/explore/*` routes.
  const [initialResult, facets] = await Promise.all([
    searchExploreEmails(supabase, {
      page: 1,
      pageSize: EXPLORE_PAGE_SIZE,
      sort: "newest"
    }),
    getExploreFacets(supabase)
  ]);

  // Pull the user's entire saved-id set up front so cards loaded later
  // via infinite scroll already know whether they're saved without an
  // extra round-trip. The payload is just UUIDs, so even users with a
  // few thousand saves cost us a few hundred KB at most. We swallow
  // errors here so a broken saves table never breaks Explore itself.
  let initialSavedIds: string[] = [];
  try {
    const savedSet = await listSavedEmailIds(supabase, user.id);
    initialSavedIds = Array.from(savedSet);
  } catch (err) {
    console.error("Failed to load saved email IDs", err);
  }

  // SSR the user's collections so the "Add to collection" popover on
  // every card has data ready on first paint. Same swallow-errors
  // strategy: a broken collections table shouldn't take down Explore.
  let initialCollections: CollectionSummary[] = [];
  try {
    initialCollections = await listCollectionSummaries(supabase, user.id);
  } catch (err) {
    console.error("Failed to load collections", err);
  }

  // Same idea for saved competitor sets — feeds the sidebar's
  // "Your competitors" section. Swallow errors so a missing table
  // never breaks Explore.
  let initialCompetitorSets: CompetitorSetSummary[] = [];
  try {
    initialCompetitorSets = await listCompetitorSetSummaries(
      supabase,
      user.id
    );
  } catch (err) {
    console.error("Failed to load competitor sets", err);
  }

  return (
    <div className={styles.shell}>
      <ExploreSidebar
        collections={initialCollections}
        competitorSets={initialCompetitorSets}
      />

      <main className={styles.main}>
        <header className={styles.heading}>
          <h1>Explore</h1>
          <p>Browse marketing emails from competing brands</p>
        </header>

        <ExploreClient
          initialEmails={initialResult.items}
          initialHasMore={initialResult.hasMore}
          pageSize={EXPLORE_PAGE_SIZE}
          facets={facets}
          initialSavedIds={initialSavedIds}
          initialCollections={initialCollections}
        />
      </main>
    </div>
  );
}
