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
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import SettingsClient from "@/components/settings/SettingsClient";
import styles from "@/components/explore/explore.module.css";

export const metadata = {
  title: "Settings — Pirol"
};

export default async function SettingsPage() {
  // Same admin gate as the rest of the app shell (/explore, /saved, …).
  const supabase = await createClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login?next=/settings");
  }

  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    redirect("/access-denied");
  }

  // The sidebar is shared across the app shell, so fetch the same
  // collections / competitor sets it renders on every other page.
  let initialCollections: CollectionSummary[] = [];
  try {
    initialCollections = await listCollectionSummaries(supabase, user.id);
  } catch (err) {
    console.error("Failed to load collections", err);
  }

  let initialCompetitorSets: CompetitorSetSummary[] = [];
  try {
    initialCompetitorSets = await listCompetitorSetSummaries(supabase, user.id);
  } catch (err) {
    console.error("Failed to load competitor sets", err);
  }

  // The Team tab restricts invites to the same email domain, so surface
  // the signed-in user's email/domain to the client skeleton.
  const email = user.email ?? "";
  const emailDomain = email.includes("@") ? email.split("@")[1] : "";

  return (
    <div className={styles.shell}>
      <ExploreSidebar
        activeId="settings"
        collections={initialCollections}
        competitorSets={initialCompetitorSets}
      />

      <main className={styles.main}>
        <header className={styles.heading}>
          <h1>Settings</h1>
          <p>Manage your account, notifications, team, and billing.</p>
        </header>

        <SettingsClient email={email} emailDomain={emailDomain} />
      </main>
    </div>
  );
}
