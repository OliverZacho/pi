import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/access";
import {
  listCollectionSummaries,
  listTeamSharedCollections,
  type CollectionSummary
} from "@/lib/collections-db";
import {
  listCompetitorSetSummaries,
  listTeamSharedSets,
  type CompetitorSetSummary
} from "@/lib/competitor-db";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getBrandsFacets, searchBrands } from "@/lib/brands-explore-db";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import OnboardingModal from "@/components/onboarding/OnboardingModal";
import type { OnboardingTrackedBrand } from "@/components/onboarding/OnboardingBrandSearch";
import { getViewerDisplay } from "@/lib/viewer-display";
import styles from "@/components/explore/explore.module.css";

/**
 * Shared shell for every in-app surface (Explore, Saved, Brands,
 * Following, Collections, Comparisons, Settings). The sidebar mounts
 * once here and persists across client-side navigations — pages render
 * only their `<main>` column, and each route's `loading.tsx` swaps just
 * that column while the sidebar stays put. Previously every page
 * rendered its own sidebar copy, so each navigation unmounted and
 * remounted it (visible as a flash of the skeleton's gray placeholder).
 *
 * `getViewer` / `getViewerDisplay` are request-cached, so pages that
 * also need them don't pay a second query. The collection / comparison
 * lists refresh whenever a mutation calls `router.refresh()` (rename,
 * delete, create all do), which re-renders layouts as well as pages.
 */
export default async function AppShellLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const viewer = await getViewer();
  const hasAccess = Boolean(viewer?.hasAccess);

  let collections: CollectionSummary[] = [];
  let competitorSets: CompetitorSetSummary[] = [];
  let user = null;
  // Props for the new-signup onboarding modal — non-null only while the
  // viewer's `onboarding_completed_at` is unset.
  let onboardingProps: {
    markets: string[];
    initialPopular: OnboardingTrackedBrand[];
  } | null = null;

  if (viewer) {
    // Free session tokens have no RLS grants on collections /
    // competitor_sets, so their sidebar lists read through the
    // service-role client (both helpers filter by user id). Paid users
    // stay on their own session client.
    const supabase = hasAccess ? await createClient() : getSupabaseAdmin();
    // Team-shared rows (owned by co-members, read-only for the viewer)
    // ride along in the same sections, appended after the viewer's own
    // rows and flagged so the sidebar can badge them. Teams are a paid
    // feature — skipped for free viewers.
    let teamCollections: CollectionSummary[] = [];
    let teamSets: CompetitorSetSummary[] = [];
    let needsOnboarding = false;
    [collections, competitorSets, teamCollections, teamSets, user, needsOnboarding] =
      await Promise.all([
        listCollectionSummaries(supabase, viewer.userId, {
          // The sidebar is the one surface that renders the "new emails"
          // dot, so it alone pays for the per-rule checks behind it.
          withNewEmailFlags: true
        }).catch((err) => {
          console.error("Failed to load sidebar collections", err);
          return [] as CollectionSummary[];
        }),
        listCompetitorSetSummaries(supabase, viewer.userId).catch((err) => {
          console.error("Failed to load sidebar competitor sets", err);
          return [] as CompetitorSetSummary[];
        }),
        hasAccess
          ? listTeamSharedCollections(supabase, getSupabaseAdmin(), viewer.userId)
              .then((shared) =>
                shared.map((c) => ({
                  id: c.id,
                  name: c.name,
                  icon: c.icon,
                  shareSlug: c.shareSlug,
                  sharedByTeam: true,
                  teamOwnerName: c.ownerName
                }))
              )
              .catch((err) => {
                console.error("Failed to load sidebar team collections", err);
                return [] as CollectionSummary[];
              })
          : ([] as CollectionSummary[]),
        hasAccess
          ? listTeamSharedSets(supabase, getSupabaseAdmin(), viewer.userId)
              .then((shared) =>
                shared.map((s) => ({
                  id: s.id,
                  name: s.name,
                  brandCount: s.brandCount,
                  updatedAt: s.updatedAt,
                  sharedByTeam: true,
                  teamOwnerName: s.ownerName
                }))
              )
              .catch((err) => {
                console.error("Failed to load sidebar team comparisons", err);
                return [] as CompetitorSetSummary[];
              })
          : ([] as CompetitorSetSummary[]),
        getViewerDisplay(),
        // New-signup onboarding gate: brand-new profiles (created after the
        // onboarding migration) have a null `onboarding_completed_at`;
        // everyone older was backfilled. Service-role read — free session
        // tokens can't select the column — and any failure counts as
        // "completed" so a profile hiccup never locks the app behind the
        // modal.
        (async () => {
          try {
            const { data, error } = await getSupabaseAdmin()
              .from("user_profiles")
              .select("onboarding_completed_at")
              .eq("user_id", viewer.userId)
              .maybeSingle();
            if (error || !data) return false;
            return data.onboarding_completed_at === null;
          } catch (err) {
            console.error("Failed to load onboarding state", err);
            return false;
          }
        })()
      ]);
    collections = [...collections, ...teamCollections];
    competitorSets = [...competitorSets, ...teamSets];

    if (needsOnboarding) {
      // Seed the modal: category chips from the live market facets, and the
      // most active brands as step 3's initial suggestion grid. Failures
      // degrade to empty lists — the modal still works via its typeahead.
      const admin = getSupabaseAdmin();
      const [facets, popular] = await Promise.all([
        getBrandsFacets(admin).catch((err) => {
          console.error("Failed to load onboarding facets", err);
          return null;
        }),
        searchBrands(admin, { sort: "most_active", pageSize: 24 }).catch(
          (err) => {
            console.error("Failed to load onboarding suggestions", err);
            return null;
          }
        )
      ]);
      onboardingProps = {
        markets: facets?.markets ?? [],
        initialPopular: (popular?.items ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          markets: item.markets,
          domain: null,
          logoUrl: item.logoUrl
        }))
      };
    }
  } else {
    // Logged-out visitors own no collections or sets; only the account
    // row needs data.
    user = await getViewerDisplay();
  }

  return (
    <div className={styles.shell}>
      <ExploreSidebar
        user={user}
        collections={collections}
        competitorSets={competitorSets}
        hasAccess={hasAccess}
        signedIn={Boolean(viewer)}
      />
      {onboardingProps ? (
        <OnboardingModal
          markets={onboardingProps.markets}
          initialPopular={onboardingProps.initialPopular}
        />
      ) : null}
      {children}
    </div>
  );
}
