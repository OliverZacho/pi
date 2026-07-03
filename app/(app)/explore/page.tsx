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
import ExploreClient from "@/components/explore/ExploreClient";
import PlanChoiceModal from "@/components/onboarding/PlanChoiceModal";
import TourStarter from "@/components/onboarding/TourStarter";
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
    // Onboarding gate for brand-new signups (both flags null until acted on):
    //   - tour not done yet  → run the guided product tour first; the forced
    //     plan modal is held back until the tour finishes or is skipped.
    //   - tour done, no plan → force the "pick a plan" modal.
    // Backfilled existing users already have a `plan_selected_at` stamp, so
    // neither ever fires for them.
    let showTour = false;
    let mustChoosePlan = false;
    if (viewer) {
      try {
        const [savedSet, count, profile] = await Promise.all([
          listSavedEmailIds(admin, viewer.userId),
          countSavedEmails(admin, viewer.userId),
          admin
            .from("user_profiles")
            .select("plan_selected_at, tour_completed_at")
            .eq("user_id", viewer.userId)
            .maybeSingle()
        ]);
        initialSavedIds = Array.from(savedSet);
        savedCount = count;
        const planChosen = Boolean(profile.data?.plan_selected_at);
        const tourDone = Boolean(profile.data?.tour_completed_at);
        showTour = !planChosen && !tourDone;
        mustChoosePlan = !planChosen && tourDone;
      } catch (err) {
        console.error("Failed to load saved email IDs", err);
      }
    }

    return (
      <>
        {showTour ? <TourStarter /> : null}
        {mustChoosePlan ? <PlanChoiceModal /> : null}
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
      </>
    );
  }

  const userId = viewer.userId;

  // Everything the page needs is independent, so fetch it in one parallel
  // fan-out rather than a chain of awaits — on a remote DB each serialized
  // round-trip is otherwise added latency the user waits through.
  //   - first page + facets: SSR so the grid is hydrated with real data on
  //     first paint ("recommended" = curated allowlist, newest first; SSR
  //     with the sort the client initialises to so paint matches hydration).
  //   - saved ids: the user's entire saved-id set up front so infinite-scroll
  //     cards already know their saved state (just UUIDs — a few hundred KB
  //     even for thousands of saves).
  //   - collections: feeds the "Add to collection" popover on every card.
  // The per-source `.catch`es swallow errors so a single broken table
  // (saves / collections) never takes down Explore itself.
  const [initialResult, facets, savedSet, initialCollections] =
    await Promise.all([
      searchExploreEmails(supabase, {
        page: 1,
        pageSize: EXPLORE_PAGE_SIZE,
        sort: "recommended"
      }),
      getExploreFacets(supabase),
      listSavedEmailIds(supabase, userId).catch((err) => {
        console.error("Failed to load saved email IDs", err);
        return new Set<string>();
      }),
      listCollectionSummaries(supabase, userId).catch((err) => {
        console.error("Failed to load collections", err);
        return [] as CollectionSummary[];
      })
    ]);
  const initialSavedIds = Array.from(savedSet);

  return (
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
  );
}
