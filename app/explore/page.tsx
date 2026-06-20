import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { FREE_SAVE_LIMIT, getViewer, PUBLIC_EXPLORE_LIMIT } from "@/lib/access";
import {
  EXPLORE_PAGE_SIZE,
  getExploreFacets,
  searchExploreEmails
} from "@/lib/explore-db";
import { countSavedEmails, listSavedEmailIds } from "@/lib/saved-emails-db";
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
import { getViewerDisplay } from "@/lib/viewer-display";
import styles from "@/components/explore/explore.module.css";

export const metadata = {
  title: "Explore — Pirol"
};

export default async function ExplorePage() {
  const supabase = await createClient();
  const viewer = await getViewer();

  // Logged-out / unpaid viewers get the interactive teaser: the real
  // Explore UI (search / filter / sort) capped to PUBLIC_EXPLORE_LIMIT with
  // a fade + unlock box. SSR the first slice + facets via the service-role
  // client (RLS would otherwise return nothing); the client then queries the
  // public `/api/public/explore/*` routes and renders previews through the
  // public render endpoint.
  if (!viewer || !viewer.hasAccess) {
    const admin = getSupabaseAdmin();
    const [preview, facets] = await Promise.all([
      searchExploreEmails(admin, {
        page: 1,
        pageSize: PUBLIC_EXPLORE_LIMIT,
        sort: "recommended"
      }),
      getExploreFacets(admin)
    ]);

    // A signed-in but unpaid viewer gets the same limited teaser, but with
    // Save enabled on its cards (the free conversion hook). Their saved
    // state + count are read via the service-role client, since their
    // session token has no RLS grant on saved_emails. Logged-out visitors
    // get no Save button.
    let initialSavedIds: string[] = [];
    let savedCount = 0;
    if (viewer) {
      try {
        const [savedSet, count] = await Promise.all([
          listSavedEmailIds(admin, viewer.userId),
          countSavedEmails(admin, viewer.userId)
        ]);
        initialSavedIds = Array.from(savedSet);
        savedCount = count;
      } catch (err) {
        console.error("Failed to load saved email IDs", err);
      }
    }

    return (
      <div className={styles.shell}>
        <ExploreSidebar user={await getViewerDisplay()} hasAccess={false} />

        <main className={styles.main}>
          <header className={styles.heading}>
            <h1>Explore</h1>
            <p>Browse marketing emails from competing brands</p>
          </header>

          <ExploreClient
            mode="public"
            allowSave={Boolean(viewer)}
            saveLimit={FREE_SAVE_LIMIT}
            initialSavedCount={savedCount}
            initialEmails={preview.items}
            initialHasMore={false}
            pageSize={PUBLIC_EXPLORE_LIMIT}
            facets={facets}
            initialSavedIds={initialSavedIds}
            initialCollections={[]}
            searchEndpoint="/api/public/explore/emails"
            renderUrlBase="/api/explore/emails"
            defaultSort="recommended"
          />
        </main>
      </div>
    );
  }

  const userId = viewer.userId;

  // Server-render the first page + facets so the grid is hydrated with
  // real data on first paint. The client takes over for subsequent
  // filtering / search / infinite scroll via the `/api/explore/*` routes.
  const [initialResult, facets] = await Promise.all([
    // "Recommended" is the default Explore order: emails from the
    // admin-curated brand allowlist, newest first. SSR with the same sort
    // the client initialises to so the first paint matches and doesn't
    // flip to a different ordering on hydration.
    searchExploreEmails(supabase, {
      page: 1,
      pageSize: EXPLORE_PAGE_SIZE,
      sort: "recommended"
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
    const savedSet = await listSavedEmailIds(supabase, userId);
    initialSavedIds = Array.from(savedSet);
  } catch (err) {
    console.error("Failed to load saved email IDs", err);
  }

  // SSR the user's collections so the "Add to collection" popover on
  // every card has data ready on first paint. Same swallow-errors
  // strategy: a broken collections table shouldn't take down Explore.
  let initialCollections: CollectionSummary[] = [];
  try {
    initialCollections = await listCollectionSummaries(supabase, userId);
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
      userId
    );
  } catch (err) {
    console.error("Failed to load competitor sets", err);
  }

  return (
    <div className={styles.shell}>
      <ExploreSidebar
        user={await getViewerDisplay()}
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
          defaultSort="recommended"
          isAdmin={viewer.isAdmin}
        />
      </main>
    </div>
  );
}
