import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/access";
import {
  listCollectionSummaries,
  listNotifiableSmartCollections,
  type CollectionSummary,
  type NotifiableSmartCollection
} from "@/lib/collections-db";
import {
  listCompetitorSetSummaries,
  type CompetitorSetSummary
} from "@/lib/competitor-db";
import { isConsumerEmailDomain } from "@/lib/email-domains";
import { getProfile, userHasPassword } from "@/lib/profile-db";
import { getNotificationPrefs } from "@/lib/notification-prefs-db";
import { defaultNotificationPrefs } from "@/lib/notification-prefs";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  getTeamContext,
  getTeamForUser,
  hasActiveTeamPlan,
  TEAM_SEAT_LIMIT,
  type TeamView
} from "@/lib/teams-db";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import SettingsClient, {
  type BillingInfo,
  type TeamMembershipInfo
} from "@/components/settings/SettingsClient";
import styles from "@/components/explore/explore.module.css";

export const metadata = {
  title: "Settings — Pirol"
};

export default async function SettingsPage() {
  // Settings stays open to any signed-in user so an unpaid visitor can
  // manage their account and reach billing to subscribe — only logged-out
  // visitors are bounced. `hasAccess` just tunes the shared sidebar.
  const supabase = await createClient();
  const viewer = await getViewer();

  if (!viewer) {
    redirect("/login?next=/settings");
  }

  const { userId, hasAccess } = viewer;

  // The Team tab restricts invites to the same email domain, so surface
  // the signed-in user's email/domain to the client.
  const email = viewer.email ?? "";
  const emailDomain = email.includes("@") ? email.split("@")[1] : "";

  // Each section degrades independently — a failed query logs and falls
  // back rather than failing the whole page.
  const logged = <T,>(label: string, fallbackValue: T) => (err: unknown): T => {
    console.error(label, err);
    return fallbackValue;
  };

  // None of these queries depend on each other (they all key off userId),
  // so run them in parallel — sequential awaits here were the reason the
  // page took seconds to respond.
  const [
    // Sidebar: shared across the app shell, same data every page renders.
    initialCollections,
    initialCompetitorSets,
    // User tab (session client — RLS scopes to the viewer).
    initialFullName,
    hasPassword,
    // Notifications tab: the viewer's saved cadences (defaults if unset).
    initialNotificationPrefs,
    // Notifications tab: the viewer's smart collections, for per-collection alerts.
    smartCollections,
    // Team tab (admin client — team tables are RLS'd to service_role
    // only; ownership is scoped by userId here).
    initialTeam,
    hasTeamPlan,
    // Team-plan membership context — drives the "managed by …" billing
    // copy and the profile badge. Session client: the RPC keys off auth.uid().
    teamContext,
    // Billing tab: the viewer's own subscription row (RLS self-select).
    subscriptionRow
  ] = await Promise.all([
    listCollectionSummaries(supabase, userId).catch(
      logged("Failed to load collections", [] as CollectionSummary[])
    ),
    listCompetitorSetSummaries(supabase, userId).catch(
      logged("Failed to load competitor sets", [] as CompetitorSetSummary[])
    ),
    getProfile(supabase, userId)
      .then((profile) => profile?.fullName ?? null)
      .catch(logged("Failed to load profile", null)),
    userHasPassword(supabase).catch(
      logged("Failed to check password state", false)
    ),
    getNotificationPrefs(supabase, userId).catch(
      logged("Failed to load notification prefs", defaultNotificationPrefs())
    ),
    listNotifiableSmartCollections(supabase, userId).catch(
      logged("Failed to load smart collections", [] as NotifiableSmartCollection[])
    ),
    getTeamForUser(getSupabaseAdmin(), userId).catch(
      logged("Failed to load team", null as TeamView | null)
    ),
    hasActiveTeamPlan(supabase, userId).catch(
      logged("Failed to check team plan", false)
    ),
    getTeamContext(supabase).catch(
      logged("Failed to load team context", null)
    ),
    supabase
      .from("subscriptions")
      .select("status, plan, current_period_end, stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle()
      // The query builder is a PromiseLike without .catch — reject via
      // then's second argument instead.
      .then(({ data }) => data, logged("Failed to load subscription", null))
  ]);

  // Sending invites requires the Team plan (admins bypass); the tab
  // surfaces an upgrade notice instead of the invite form otherwise.
  const canInviteTeam = viewer.isAdmin || hasTeamPlan;

  // The same-domain invite rule only means something on a company
  // domain; consumer providers (gmail etc.) invite freely.
  const inviteDomainRestricted =
    Boolean(emailDomain) && !isConsumerEmailDomain(emailDomain);

  const teamMembership: TeamMembershipInfo = teamContext
    ? {
        role: teamContext.role,
        teamName: teamContext.teamName,
        ownerName: teamContext.ownerName,
        ownerActive: teamContext.ownerActive
      }
    : null;

  const billing: BillingInfo = subscriptionRow
    ? {
        status: subscriptionRow.status,
        plan: subscriptionRow.plan,
        currentPeriodEnd: subscriptionRow.current_period_end,
        hasBillingAccount: Boolean(subscriptionRow.stripe_customer_id)
      }
    : {
        status: "inactive",
        plan: null,
        currentPeriodEnd: null,
        hasBillingAccount: false
      };

  return (
    <div className={styles.shell}>
      {/* Built from data already fetched above — getViewerDisplay would
          re-query the profile for the same name/email. */}
      <ExploreSidebar
        user={{ name: initialFullName, email }}
        activeId="settings"
        collections={initialCollections}
        competitorSets={initialCompetitorSets}
        hasAccess={hasAccess}
      />

      <main className={styles.main}>
        <header className={styles.heading}>
          <h1>Settings</h1>
          <p>Manage your account, notifications, team, and billing.</p>
        </header>

        <SettingsClient
          email={email}
          emailDomain={emailDomain}
          viewerId={userId}
          initialFullName={initialFullName}
          hasPassword={hasPassword}
          initialTeam={initialTeam}
          canInviteTeam={canInviteTeam}
          inviteDomainRestricted={inviteDomainRestricted}
          seatLimit={TEAM_SEAT_LIMIT}
          teamMembership={teamMembership}
          billing={billing}
          initialNotificationPrefs={initialNotificationPrefs}
          notificationsEnabled={hasAccess}
          smartCollections={smartCollections}
        />
      </main>
    </div>
  );
}
