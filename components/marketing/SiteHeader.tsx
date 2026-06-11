import Header, { type HeaderUser } from "./Header";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/access";
import { getProfile } from "@/lib/profile-db";

/**
 * Server wrapper for the marketing <Header />: resolves the signed-in
 * viewer (locally-verified JWT via getViewer, no auth-server call) and
 * their display name, so the header renders the right state on first
 * paint with no logged-out flash.
 */
export default async function SiteHeader() {
  const viewer = await getViewer();

  let user: HeaderUser | null = null;
  if (viewer) {
    let name: string | null = null;
    try {
      const supabase = await createClient();
      name = (await getProfile(supabase, viewer.userId))?.fullName ?? null;
    } catch {
      // Display-only — fall back to email initials rather than failing the page.
    }
    user = { name, email: viewer.email ?? "" };
  }

  return <Header user={user} />;
}
