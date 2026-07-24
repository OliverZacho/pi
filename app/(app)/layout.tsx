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
import ExploreSidebar from "@/components/explore/ExploreSidebar";
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

  if (viewer && hasAccess) {
    const supabase = await createClient();
    // Team-shared rows (owned by co-members, read-only for the viewer)
    // ride along in the same sections, appended after the viewer's own
    // rows and flagged so the sidebar can badge them.
    let teamCollections: CollectionSummary[] = [];
    let teamSets: CompetitorSetSummary[] = [];
    [collections, competitorSets, teamCollections, teamSets, user] =
      await Promise.all([
        listCollectionSummaries(supabase, viewer.userId).catch((err) => {
          console.error("Failed to load sidebar collections", err);
          return [] as CollectionSummary[];
        }),
        listCompetitorSetSummaries(supabase, viewer.userId).catch((err) => {
          console.error("Failed to load sidebar competitor sets", err);
          return [] as CompetitorSetSummary[];
        }),
        listTeamSharedCollections(supabase, getSupabaseAdmin(), viewer.userId)
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
          }),
        listTeamSharedSets(supabase, getSupabaseAdmin(), viewer.userId)
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
          }),
        getViewerDisplay()
      ]);
    collections = [...collections, ...teamCollections];
    competitorSets = [...competitorSets, ...teamSets];
  } else {
    // Locked-out viewers (logged-out or unpaid) own no collections or
    // sets; only the account row needs data.
    user = await getViewerDisplay();
  }

  return (
    <div className={styles.shell}>
      <ExploreSidebar
        user={user}
        collections={collections}
        competitorSets={competitorSets}
        hasAccess={hasAccess}
      />
      {children}
    </div>
  );
}
