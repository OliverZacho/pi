import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listSavedEmails } from "@/lib/saved-emails-db";
import {
  listCollectionSummaries,
  type CollectionSummary
} from "@/lib/collections-db";
import ExploreSidebar from "@/components/explore/ExploreSidebar";
import SavedGalleryClient from "@/components/explore/SavedGalleryClient";
import styles from "@/components/explore/explore.module.css";

export const metadata = {
  title: "Saved — Pirol"
};

export default async function SavedPage() {
  // Same admin gate as `/explore` — the render endpoint that powers the
  // card iframes still requires admin. When we expose Pirol to non-admin
  // users we'll swap the iframe source for a public endpoint and drop
  // both checks together.
  const supabase = await createClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login?next=/saved");
  }

  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    redirect("/access-denied");
  }

  const { items, total } = await listSavedEmails(supabase, user.id);

  let initialCollections: CollectionSummary[] = [];
  try {
    initialCollections = await listCollectionSummaries(supabase, user.id);
  } catch (err) {
    console.error("Failed to load collections", err);
  }

  return (
    <div className={styles.shell}>
      <ExploreSidebar activeId="saved" collections={initialCollections} />

      <main className={styles.main}>
        <header className={styles.heading}>
          <h1>Saved</h1>
          <p>
            {total === 0
              ? "Bookmarked emails will show up here."
              : `${total} saved ${total === 1 ? "email" : "emails"}.`}
          </p>
        </header>

        <SavedGalleryClient
          initialEmails={items}
          initialCollections={initialCollections}
        />
      </main>
    </div>
  );
}
