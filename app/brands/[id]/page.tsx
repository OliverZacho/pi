import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBrandPageData } from "@/lib/brand-db";
import {
  listCollectionSummaries,
  type CollectionSummary
} from "@/lib/collections-db";
import {
  listCompetitorSetSummaries,
  listSetIdsContainingBrand,
  type CompetitorSetSummary
} from "@/lib/competitor-db";
import { isBrandFollowed } from "@/lib/follows-db";
import BrandDashboard from "@/components/brand/BrandDashboard";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import styles from "@/components/brand/brand.module.css";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ segment?: string | string[] }>;
};

/**
 * Per-brand SaaS-style dashboard. The companion to `/explore`: where
 * Explore answers "show me what's hitting inboxes", this page answers
 * "tell me everything you know about this one brand's email program".
 *
 * Auth gating mirrors the Explore route — the email render endpoint each
 * thumbnail iframe consumes is admin-only today, and there's no value
 * in showing partial analytics to logged-out viewers.
 */
export async function generateMetadata({ params }: RouteParams) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("companies")
    .select("name")
    .eq("id", id)
    .maybeSingle();

  return {
    title: data?.name ? `${data.name} — Pirol` : "Brand — Pirol"
  };
}

export default async function BrandPage({ params, searchParams }: RouteParams) {
  const { id } = await params;
  const { segment } = await searchParams;
  const segmentInboxId = Array.isArray(segment) ? segment[0] : segment ?? null;
  const supabase = await createClient();

  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect(`/login?next=/brands/${encodeURIComponent(id)}`);
  }

  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    redirect("/access-denied");
  }

  const data = await getBrandPageData(supabase, id, { segmentInboxId });
  if (!data) {
    notFound();
  }

  let sidebarCollections: CollectionSummary[] = [];
  try {
    sidebarCollections = await listCollectionSummaries(supabase, user.id);
  } catch (err) {
    console.error("Failed to load collections", err);
  }
  let sidebarSets: CompetitorSetSummary[] = [];
  try {
    sidebarSets = await listCompetitorSetSummaries(supabase, user.id);
  } catch (err) {
    console.error("Failed to load competitor sets", err);
  }

  // Follow status + group memberships are loaded in parallel — both are
  // tiny lookups and we'd otherwise be paying two extra round trips
  // serially before the page renders.
  const [isFollowing, groupMembershipIds] = await Promise.all([
    isBrandFollowed(supabase, user.id, id).catch((err) => {
      console.error("Failed to load follow status", err);
      return false;
    }),
    listSetIdsContainingBrand(supabase, user.id, id).catch((err) => {
      console.error("Failed to load group memberships", err);
      return new Set<string>();
    })
  ]);

  return (
    <div className={styles.shell}>
      <ExploreSidebar
        activeId="brands"
        collections={sidebarCollections}
        competitorSets={sidebarSets}
      />
      <BrandDashboard
        data={data}
        isFollowing={isFollowing}
        groups={sidebarSets}
        groupMembershipIds={Array.from(groupMembershipIds)}
      />
    </div>
  );
}
