import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  listCollectionSummaries,
  type CollectionSummary
} from "@/lib/collections-db";
import {
  listCompetitorSetSummaries,
  type CompetitorSetSummary
} from "@/lib/competitor-db";
import {
  listFollowedBrandCards,
  type FollowedBrandCard
} from "@/lib/follows-db";
import {
  EXPLORE_PAGE_SIZE,
  getExploreFacets,
  searchExploreEmails,
  type ExploreFacets,
  type ExploreSearchResult
} from "@/lib/explore-db";
import { listSavedEmailIds } from "@/lib/saved-emails-db";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import FollowingClient from "@/components/following/FollowingClient";
import styles from "@/components/brand/brands-explore.module.css";

export const metadata = {
  title: "Following — Pirol"
};

export const dynamic = "force-dynamic";

const EMPTY_FACETS: ExploreFacets = { brands: [], markets: [], categories: [] };

/**
 * `/following` — everything from the brands the current user follows.
 *
 * Two views share the page via a toggle: a brand-card grid (companion to
 * `/brands`, scoped to follows) and a follow-scoped email flow (companion
 * to `/explore`, restricted server-side to the followed brands). Both
 * support search + filters. We SSR the first page of each so switching
 * views is instant; the email flow then takes over client-side via
 * `/api/following/emails`.
 */
export default async function FollowingPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login?next=/following");
  }

  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    redirect("/access-denied");
  }

  const [followed, sidebarCollections, sidebarSets] = await Promise.all([
    listFollowedBrandCards(supabase, user.id).catch((err) => {
      console.error("Failed to load followed brands", err);
      return [] as FollowedBrandCard[];
    }),
    listCollectionSummaries(supabase, user.id).catch((err) => {
      console.error("Failed to load collections", err);
      return [] as CollectionSummary[];
    }),
    listCompetitorSetSummaries(supabase, user.id).catch((err) => {
      console.error("Failed to load competitor sets", err);
      return [] as CompetitorSetSummary[];
    })
  ]);

  const followedIds = followed.map((brand) => brand.id);

  // SSR the follow-scoped email flow + its facets so the Emails tab is
  // hydrated the moment the user switches to it. Skip the work entirely
  // when the user follows nothing — there's nothing to scope to.
  const [emailResult, emailFacets, savedIds] = await Promise.all([
    followedIds.length > 0
      ? searchExploreEmails(supabase, {
          page: 1,
          pageSize: EXPLORE_PAGE_SIZE,
          sort: "newest",
          restrictBrandIds: followedIds
        }).catch((err) => {
          console.error("Failed to load followed-brand emails", err);
          return {
            items: [],
            total: 0,
            page: 1,
            pageSize: EXPLORE_PAGE_SIZE,
            hasMore: false
          } as ExploreSearchResult;
        })
      : Promise.resolve({
          items: [],
          total: 0,
          page: 1,
          pageSize: EXPLORE_PAGE_SIZE,
          hasMore: false
        } as ExploreSearchResult),
    followedIds.length > 0
      ? getExploreFacets(supabase, { restrictBrandIds: followedIds }).catch(
          (err) => {
            console.error("Failed to load followed-brand facets", err);
            return EMPTY_FACETS;
          }
        )
      : Promise.resolve(EMPTY_FACETS),
    listSavedEmailIds(supabase, user.id)
      .then((set) => Array.from(set))
      .catch((err) => {
        console.error("Failed to load saved email IDs", err);
        return [] as string[];
      })
  ]);

  return (
    <div className={styles.shell}>
      <ExploreSidebar
        activeId="following"
        collections={sidebarCollections}
        competitorSets={sidebarSets}
      />

      <main className={styles.main}>
        <header className={styles.heading}>
          <h1>Following</h1>
          <p>
            {followed.length === 0
              ? "Brands you follow will show up here."
              : `${followed.length} ${
                  followed.length === 1 ? "brand" : "brands"
                } you follow.`}
          </p>
        </header>

        <FollowingClient
          brands={followed}
          initialEmails={emailResult.items}
          initialHasMore={emailResult.hasMore}
          emailPageSize={EXPLORE_PAGE_SIZE}
          emailFacets={emailFacets}
          initialSavedIds={savedIds}
          initialCollections={sidebarCollections}
        />
      </main>
    </div>
  );
}
