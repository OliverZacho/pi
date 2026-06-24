import Link from "next/link";
import { redirect } from "next/navigation";
import CopySharedItemsButton from "@/components/team/CopySharedItemsButton";
import TrackedUpgradeLink from "@/components/common/TrackedUpgradeLink";
import { getViewer } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  getTeamMembership,
  markNoticeSeen,
  resolveTeamGate
} from "@/lib/teams-db";
import styles from "./team-inactive.module.css";

export const metadata = {
  title: "Team plan — Pirol"
};

/**
 * Interstitial shown when a user's team access has ended — either they were
 * removed from the team, or the owner's plan lapsed. The auth callback
 * diverts here on login; the Billing tab links here in-session.
 *
 * Offers them their own subscription (Team or Solo, via the pricing page)
 * or to keep browsing for free. Their saved data is untouched either way.
 */
export default async function TeamInactivePage() {
  const supabase = await createClient();
  const viewer = await getViewer();

  if (!viewer) {
    redirect("/login?next=/team/inactive");
  }

  const admin = getSupabaseAdmin();
  const gate = await resolveTeamGate(supabase, admin, viewer.userId);

  // They still have access (or never had a team issue) — nothing to show.
  if (!gate) {
    redirect("/explore");
  }

  // A removal notice is one-time: showing it here counts as seen.
  if (gate.kind === "removed") {
    await markNoticeSeen(admin, gate.noticeId).catch(() => {});
  }

  // How many shared items the member could copy. Only lapsed members still
  // have a team_members row (removal deletes it), so this is naturally zero
  // for the removed case.
  let sharedCount = 0;
  try {
    const membership = await getTeamMembership(admin, viewer.userId);
    if (membership) {
      const otherIds = membership.memberIds.filter(
        (uid) => uid !== viewer.userId
      );
      if (otherIds.length > 0) {
        const [{ count: cols }, { count: sets }] = await Promise.all([
          admin
            .from("collections")
            .select("id", { count: "exact", head: true })
            .eq("shared_with_team", true)
            .in("user_id", otherIds),
          admin
            .from("competitor_sets")
            .select("id", { count: "exact", head: true })
            .eq("shared_with_team", true)
            .in("user_id", otherIds)
        ]);
        sharedCount = (cols ?? 0) + (sets ?? 0);
      }
    }
  } catch (err) {
    console.error("Failed to count shared items", err);
  }

  const heading =
    gate.kind === "removed"
      ? `You've been removed from ${gate.teamName}`
      : `${gate.teamName}'s plan is no longer active`;

  const body =
    gate.kind === "removed"
      ? "Your access through the team has ended. Subscribe to keep full access, or keep browsing Pirol for free."
      : "The team plan you were part of is no longer subscribing. Subscribe to keep full access, or keep browsing Pirol for free.";

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.title}>{heading}</h1>
        <p className={styles.body}>{body}</p>
        <p className={styles.note}>
          Your saved emails, followed brands and collections are still yours —
          nothing was deleted.
        </p>
        <div className={styles.actions}>
          <TrackedUpgradeLink
            source={gate.kind === "removed" ? "team_removed" : "team_lapsed"}
            className={styles.primary}
          >
            See plans &amp; subscribe
          </TrackedUpgradeLink>
          {sharedCount > 0 ? (
            <CopySharedItemsButton
              className={styles.secondary}
              count={sharedCount}
            />
          ) : null}
          <Link href="/explore" className={styles.secondary}>
            Continue with free access
          </Link>
        </div>
      </div>
    </main>
  );
}
