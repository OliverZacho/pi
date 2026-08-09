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
import { FREE_FOLLOW_LIMIT, getViewer } from "@/lib/access";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import LockedFeature from "@/components/access/LockedFeature";
import FollowingClient from "@/components/following/FollowingClient";
import TrackedUpgradeLink from "@/components/common/TrackedUpgradeLink";
import styles from "@/components/brand/brands-explore.module.css";
import quotaStyles from "@/components/explore/explore.module.css";

export const metadata = {
  title: "Following — Pirol"
};

export const dynamic = "force-dynamic";

const EMPTY_FACETS: ExploreFacets = {
  brands: [],
  markets: [],
  categories: [],
  countries: []
};

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
  const viewer = await getViewer();

  // Open to every signed-in user (free accounts follow up to
  // FREE_FOLLOW_LIMIT brands); only logged-out visitors see the teaser.
  if (!viewer) {
    return (
      <main className={styles.main}>
        <LockedFeature variant="following" />
      </main>
    );
  }

  // Free session tokens have no RLS grants on brand_follows or the
  // archive tables, so their reads run on the service-role client —
  // every helper here filters by user id explicitly. Paid/admin users
  // stay on their own session client (RLS scopes the rows).
  const supabase = viewer.hasAccess ? await createClient() : getSupabaseAdmin();

  const userId = viewer.userId;

  // First batch: everything that doesn't need the followed-brand ids —
  // including the saved-id set, which would otherwise wait a round trip
  // for no reason. Collections feed the "Add to collection" popover and
  // comparisons the batch bar's "Add to comparison" action.
  const [followed, collections, comparisons, savedIds] = await Promise.all([
    listFollowedBrandCards(supabase, userId).catch((err) => {
      console.error("Failed to load followed brands", err);
      return [] as FollowedBrandCard[];
    }),
    listCollectionSummaries(supabase, userId).catch((err) => {
      console.error("Failed to load collections", err);
      return [] as CollectionSummary[];
    }),
    listCompetitorSetSummaries(supabase, userId).catch((err) => {
      console.error("Failed to load competitor sets", err);
      return [] as CompetitorSetSummary[];
    }),
    listSavedEmailIds(supabase, userId)
      .then((set) => Array.from(set))
      .catch((err) => {
        console.error("Failed to load saved email IDs", err);
        return [] as string[];
      })
  ]);

  const followedIds = followed.map((brand) => brand.id);

  // SSR the follow-scoped email flow + its facets so the Emails tab is
  // hydrated the moment the user switches to it. Skip the work entirely
  // when the user follows nothing — there's nothing to scope to.
  const [emailResult, emailFacets] = await Promise.all([
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
      : Promise.resolve(EMPTY_FACETS)
  ]);

  return (
    <main className={styles.main}>
      <header className={styles.heading}>
        <h1>Following</h1>
        <p>
          {followed.length === 0
            ? "Brands you follow will show up here."
            : viewer.hasAccess
              ? `${followed.length} ${
                  followed.length === 1 ? "brand" : "brands"
                } you follow.`
              : `${followed.length} of ${FREE_FOLLOW_LIMIT} free follows used.`}
        </p>
      </header>

      {!viewer.hasAccess && followed.length >= FREE_FOLLOW_LIMIT ? (
        <div className={quotaStyles.saveQuota}>
          <span className={quotaStyles.saveQuotaText}>
            You follow all {FREE_FOLLOW_LIMIT} free brands. Upgrade for
            unlimited follows, collections, and the full archive.
          </span>
          <TrackedUpgradeLink
            source="follow_quota"
            className={quotaStyles.saveQuotaCta}
          >
            View plans
          </TrackedUpgradeLink>
        </div>
      ) : null}

      <FollowingClient
        brands={followed}
        initialEmails={emailResult.items}
        initialHasMore={emailResult.hasMore}
        emailPageSize={EXPLORE_PAGE_SIZE}
        emailFacets={emailFacets}
        initialSavedIds={savedIds}
        initialCollections={collections}
        comparisons={comparisons}
      />
    </main>
  );
}
