import Link from "next/link";
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
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import styles from "@/components/brand/brands-explore.module.css";

export const metadata = {
  title: "Following — Pirol"
};

export const dynamic = "force-dynamic";

/**
 * `/following` — every brand the current user follows.
 *
 * Companion to `/brands`: same shell + card grid, but scoped to the
 * brands the user has explicitly opted in to via the Follow toggle on
 * the brand dashboard. The data layer is intentionally lightweight
 * (no ESP / cadence aggregates) since this list is short and we want
 * the page to render without paying for the captured-emails sweep
 * that `searchBrands` does.
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
              : `${followed.length} ${followed.length === 1 ? "brand" : "brands"} you follow.`}
          </p>
        </header>

        {followed.length === 0 ? (
          <div className={styles.empty}>
            You&apos;re not following any brands yet. Open{" "}
            <Link href="/brands">Brands</Link> and tap{" "}
            <strong>Follow brand</strong> on the ones you care about.
          </div>
        ) : (
          <div className={styles.grid}>
            {followed.map((brand) => (
              <FollowingCard key={brand.id} brand={brand} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function FollowingCard({ brand }: { brand: FollowedBrandCard }) {
  return (
    <Link
      href={`/brands/${brand.id}`}
      className={styles.card}
      aria-label={`Open ${brand.name} dashboard`}
    >
      <span className={styles.cardAvatar} aria-hidden="true">
        {brand.logoUrl ? (
          <img
            src={brand.logoUrl}
            alt=""
            className={styles.cardAvatarLogo}
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className={styles.cardAvatarMonogram}>
            {brand.name.charAt(0).toUpperCase()}
          </span>
        )}
      </span>

      <div className={styles.cardBody}>
        <span className={styles.cardName}>{brand.name}</span>
        {brand.markets.length > 0 ? (
          <span className={styles.cardMarket}>
            {brand.markets.map(formatMarketLabel).join(" · ")}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

function formatMarketLabel(market: string): string {
  if (!market) return market;
  return market
    .split("_")
    .map((part) =>
      part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join(" ");
}
