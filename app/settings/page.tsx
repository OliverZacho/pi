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
import { getProfile, userHasPassword } from "@/lib/profile-db";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getTeamForUser, type TeamView } from "@/lib/teams-db";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import SettingsClient from "@/components/settings/SettingsClient";
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

  // Team tab initial data (admin client — team tables are RLS'd to
  // service_role only; ownership is scoped by userId here).
  let initialTeam: TeamView | null = null;
  try {
    initialTeam = await getTeamForUser(getSupabaseAdmin(), userId);
  } catch (err) {
    console.error("Failed to load team", err);
  }

  return (
    <div className={styles.shell}>
      <ExploreSidebar
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
        />
      </main>
    </div>
  );
}
