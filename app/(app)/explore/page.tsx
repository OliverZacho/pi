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
import { getTeamContext } from "@/lib/teams-db";
import { syncCheckoutSuccess } from "@/lib/stripe-sync";
import ExploreClient from "@/components/explore/ExploreClient";
import PlanChoiceModal from "@/components/onboarding/PlanChoiceModal";
import TeamWelcomeModal from "@/components/onboarding/TeamWelcomeModal";
import styles from "@/components/explore/explore.module.css";

/**
 * Forced plan choice is HELD BACK: new signups go straight into the app
 * after the onboarding modal (mounted by the app-shell layout) instead of
 * being routed through the "pick a plan" modal. Kept wired behind this flag
 * because it may return as an A/B-tested step 4 of onboarding — flipping it
 * to true restores the old behavior, now gated on `onboarding_completed_at`
 * instead of the retired tour stamp.
 */
const PLAN_CHOICE_ENABLED = false;

export const metadata = {
  title: "Explore — Pirol"
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ExplorePage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const params = await searchParams;
  // One-shot flag set by the auth callback right after a team invite is
  // claimed — the welcome modal below only renders on that landing.
  const teamWelcome = params.team_welcome === "1";
  // Landing back from a paid Stripe checkout. The webhook usually lags the
  // redirect by a few seconds, so if entitlement hasn't flipped yet we
  // reconcile with Stripe ourselves — a paying customer must never see the
  // capped teaser or the forced plan modal.
  const checkoutSuccess = params.checkout === "success";
  const checkoutSessionId =
    typeof params.session_id === "string" ? params.session_id : null;

  let viewer = await getViewer();
  if (viewer && !viewer.hasAccess && checkoutSuccess && checkoutSessionId) {
    const live = await syncCheckoutSuccess(checkoutSessionId, viewer.userId);
    // getViewer() is request-cached, so flip the flag rather than re-resolve.
    if (live) viewer = { ...viewer, hasAccess: true };
  }

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
    // Forced plan modal (currently held back — see PLAN_CHOICE_ENABLED):
    // unpaid-only, and only once the onboarding modal is done so the two
    // never stack. Never on a checkout=success landing, even if the Stripe
    // reconcile above couldn't confirm the sub: someone who just paid must
    // never be forced to pick a plan.
    let mustChoosePlan = false;
    if (viewer) {
      try {
        const [savedSet, count, profile] = await Promise.all([
          listSavedEmailIds(admin, viewer.userId),
          countSavedEmails(admin, viewer.userId),
          admin
            .from("user_profiles")
            .select("plan_selected_at, onboarding_completed_at")
            .eq("user_id", viewer.userId)
            .maybeSingle()
        ]);
        initialSavedIds = Array.from(savedSet);
        savedCount = count;
        const planChosen = Boolean(profile.data?.plan_selected_at);
        const onboarded = Boolean(profile.data?.onboarding_completed_at);
        mustChoosePlan =
          PLAN_CHOICE_ENABLED && !planChosen && onboarded && !checkoutSuccess;
      } catch (err) {
        console.error("Failed to load saved email IDs", err);
      }
    }

    return (
      <>
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
  const [initialResult, facets, savedSet, initialCollections, teamCtx] =
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
      }),
      // Team name + who added them, for the invited-member welcome modal.
      // Only fetched on the one-shot welcome landing; a failure just means
      // no modal, never a broken Explore.
      teamWelcome
        ? getTeamContext(supabase).catch((err) => {
            console.error("Failed to load team context for welcome", err);
            return null;
          })
        : Promise.resolve(null)
    ]);
  const initialSavedIds = Array.from(savedSet);

  return (
    <>
      {teamCtx && teamCtx.role === "member" ? (
        <TeamWelcomeModal
          teamName={teamCtx.teamName}
          ownerName={teamCtx.ownerName}
        />
      ) : null}
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
    </>
  );
}
