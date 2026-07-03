import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/access";
import LockedFeature from "@/components/access/LockedFeature";
import TeamSharedCard from "@/components/team/TeamSharedCard";
import {
  listCollectionsWithPreviews,
  listTeamSharedCollections,
  type TeamSharedCollection
} from "@/lib/collections-db";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import CollectionsGridClient from "@/components/collections/CollectionsGridClient";
import styles from "@/components/explore/explore.module.css";
import shared from "@/components/team/team-shared.module.css";

export const metadata = {
  title: "Collections — Pirol"
};

export default async function CollectionsPage() {
  const supabase = await createClient();
  const viewer = await getViewer();

  // Collections is a paid feature — public (non-admin) users see a
  // subscribe panel instead of (their non-existent) collections.
  if (!viewer || !viewer.hasAccess) {
    return (
      <main className={styles.main}>
        <LockedFeature variant="collections" />
      </main>
    );
  }

  const userId = viewer.userId;

  // Fan out the page's reads in parallel rather than awaiting them in a
  // chain. The grid's preview payload and the team-shared list are
  // independent; the non-essential source swallows its own error so a
  // broken table never takes down the page.
  const [items, teamShared] = await Promise.all([
    listCollectionsWithPreviews(supabase, userId),
    // Collections teammates have shared with the viewer's team (read-only).
    listTeamSharedCollections(supabase, getSupabaseAdmin(), userId).catch(
      (err) => {
        console.error("Failed to load team-shared collections", err);
        return [] as TeamSharedCollection[];
      }
    )
  ]);

  return (
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

      {teamShared.length > 0 ? (
        <section className={shared.section}>
          <h2 className={shared.title}>Shared with your team</h2>
          <p className={shared.subtitle}>
            Collections teammates have shared. You can view and copy them.
          </p>
          <div className={shared.grid}>
            {teamShared.map((c) => (
              <TeamSharedCard
                key={c.id}
                type="collection"
                id={c.id}
                href={`/collections/${c.id}`}
                name={c.name}
                icon={c.icon ?? "📁"}
                meta={`Shared by ${c.ownerName ?? "a teammate"}`}
              />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
