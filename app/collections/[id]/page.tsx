import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getCollectionForOwner,
  listCollectionSummaries,
  markCollectionViewed,
  type CollectionSummary
} from "@/lib/collections-db";
import {
  listCompetitorSetSummaries,
  type CompetitorSetSummary
} from "@/lib/competitor-db";
import { getExploreFacets, type ExploreFacets } from "@/lib/explore-db";
import { listSavedEmailIds } from "@/lib/saved-emails-db";
import CollectionDetailClient from "@/components/collections/CollectionDetailClient";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import styles from "@/components/explore/explore.module.css";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return {
    title: `Collection — Pirol`,
    description: `View collection ${id}`
  };
}

export default async function CollectionDetailPage({ params }: PageProps) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect(`/login?next=/collections/${id}`);
  }

  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    redirect("/access-denied");
  }

  const collection = await getCollectionForOwner(supabase, user.id, id);
  if (!collection) {
    notFound();
  }

  try {
    await markCollectionViewed(supabase, user.id, id);
  } catch (err) {
    console.error("Failed to mark collection viewed", err);
  }

  // We still want the Save/Unsave bookmark state on every card so the
  // user's existing Saved list lights up here, same as on Explore.
  let savedIds: string[] = [];
  try {
    const set = await listSavedEmailIds(
      supabase,
      user.id,
      collection.emails.map((email) => email.id)
    );
    savedIds = Array.from(set);
  } catch (err) {
    console.error("Failed to load saved ids for collection", err);
  }

  // Pre-load every collection this user owns so the "Add to another
  // collection" popover on each card works without an extra fetch.
  let collections: CollectionSummary[] = [];
  try {
    collections = await listCollectionSummaries(supabase, user.id);
  } catch (err) {
    console.error("Failed to load collections", err);
  }

  let competitorSets: CompetitorSetSummary[] = [];
  try {
    competitorSets = await listCompetitorSetSummaries(supabase, user.id);
  } catch (err) {
    console.error("Failed to load competitor sets", err);
  }

  // The rules editor needs the canonical list of brands / markets /
  // categories so its dropdowns are exhaustive — same facets the
  // Explore page uses for its own filter chips.
  let facets: ExploreFacets = { brands: [], markets: [], categories: [] };
  try {
    facets = await getExploreFacets(supabase);
  } catch (err) {
    console.error("Failed to load explore facets", err);
  }

  return (
    <div className={styles.shell}>
      <ExploreSidebar
        activeId={`collection:${collection.id}`}
        collections={collections}
        competitorSets={competitorSets}
      />

      <main className={styles.main}>
        <CollectionDetailClient
          initialCollection={collection}
          initialSavedIds={savedIds}
          initialCollections={collections}
          facets={facets}
        />
      </main>
    </div>
  );
}
