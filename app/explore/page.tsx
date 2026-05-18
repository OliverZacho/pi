import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getExploreEmails } from "@/lib/explore-db";
import ExploreClient from "@/components/explore/ExploreClient";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import styles from "@/components/explore/explore.module.css";

export const metadata = {
  title: "Explore — Pirol"
};

export default async function ExplorePage() {
  // The render endpoint that powers each card iframe is admin-only, so the
  // page itself enforces the same gate. When we later expose Explore to
  // non-admin users, swap this for a public render endpoint (or pre-generated
  // thumbnails) and drop the redirect.
  const supabase = await createClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login?next=/explore");
  }

  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    redirect("/access-denied");
  }

  const emails = await getExploreEmails(supabase);

  return (
    <div className={styles.shell}>
      <ExploreSidebar />

      <main className={styles.main}>
        <header className={styles.heading}>
          <h1>Explore</h1>
          <p>Browse marketing emails from competing brands</p>
        </header>

        <ExploreClient emails={emails} />
      </main>
    </div>
  );
}
