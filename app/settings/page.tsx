import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/access";
import {
  listCollectionSummaries,
  type CollectionSummary
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
import { getViewerDisplay } from "@/lib/viewer-display";
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

  // The sidebar is shared across the app shell, so fetch the same
  // collections / competitor sets it renders on every other page.
  let initialCollections: CollectionSummary[] = [];
  try {
    initialCollections = await listCollectionSummaries(supabase, userId);
  } catch (err) {
    console.error("Failed to load collections", err);
  }

  let initialCompetitorSets: CompetitorSetSummary[] = [];
  try {
    initialCompetitorSets = await listCompetitorSetSummaries(supabase, userId);
  } catch (err) {
    console.error("Failed to load competitor sets", err);
  }

  // The Team tab restricts invites to the same email domain, so surface
  // the signed-in user's email/domain to the client.
  const email = viewer.email ?? "";
  const emailDomain = email.includes("@") ? email.split("@")[1] : "";

  // User tab initial data (session client — RLS scopes to the viewer).
  let initialFullName: string | null = null;
  try {
    const profile = await getProfile(supabase, userId);
    initialFullName = profile?.fullName ?? null;
  } catch (err) {
    console.error("Failed to load profile", err);
  }

  let hasPassword = false;
  try {
    hasPassword = await userHasPassword(supabase);
  } catch (err) {
    console.error("Failed to check password state", err);
  }

  // Notifications tab: the viewer's saved cadences (defaults if unset).
  let initialNotificationPrefs = defaultNotificationPrefs();
  try {
    initialNotificationPrefs = await getNotificationPrefs(supabase, userId);
  } catch (err) {
    console.error("Failed to load notification prefs", err);
  }

  // Team tab initial data (admin client — team tables are RLS'd to
  // service_role only; ownership is scoped by userId here).
  let initialTeam: TeamView | null = null;
  try {
    initialTeam = await getTeamForUser(getSupabaseAdmin(), userId);
  } catch (err) {
    console.error("Failed to load team", err);
  }

  // Sending invites requires the Team plan (admins bypass); the tab
  // surfaces an upgrade notice instead of the invite form otherwise.
  let canInviteTeam = viewer.isAdmin;
  if (!canInviteTeam) {
    try {
      canInviteTeam = await hasActiveTeamPlan(supabase, userId);
    } catch (err) {
      console.error("Failed to check team plan", err);
    }
  }

  // The same-domain invite rule only means something on a company
  // domain; consumer providers (gmail etc.) invite freely.
  const inviteDomainRestricted =
    Boolean(emailDomain) && !isConsumerEmailDomain(emailDomain);

  // Team-plan membership context — drives the "managed by …" billing copy
  // and the profile badge. Session client: the RPC keys off auth.uid().
  let teamMembership: TeamMembershipInfo = null;
  try {
    const ctx = await getTeamContext(supabase);
    if (ctx) {
      teamMembership = {
        role: ctx.role,
        teamName: ctx.teamName,
        ownerName: ctx.ownerName,
        ownerActive: ctx.ownerActive
      };
    }
  } catch (err) {
    console.error("Failed to load team context", err);
  }

  // Billing tab state — the viewer's own subscription row (RLS self-select).
  let billing: BillingInfo = {
    status: "inactive",
    plan: null,
    currentPeriodEnd: null,
    hasBillingAccount: false
  };
  try {
    const { data } = await supabase
      .from("subscriptions")
      .select("status, plan, current_period_end, stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (data) {
      billing = {
        status: data.status,
        plan: data.plan,
        currentPeriodEnd: data.current_period_end,
        hasBillingAccount: Boolean(data.stripe_customer_id)
      };
    }
  } catch (err) {
    console.error("Failed to load subscription", err);
  }

  return (
    <div className={styles.shell}>
      <ExploreSidebar
        user={await getViewerDisplay()}
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
        />
      </main>
    </div>
  );
}
