import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/access";
import { getProfile } from "@/lib/profile-db";

/** Display-only identity for chrome (header avatar, sidebar account row). */
export type ViewerDisplay = {
  name: string | null;
  email: string;
};

/**
 * Resolve the signed-in viewer's display name + email for UI chrome.
 * Request-cached so layouts and pages can both call it for the price of
 * one profile lookup; returns null for logged-out visitors.
 */
export const getViewerDisplay = cache(
  async (): Promise<ViewerDisplay | null> => {
    const viewer = await getViewer();
    if (!viewer) return null;

    let name: string | null = null;
    try {
      const supabase = await createClient();
      name = (await getProfile(supabase, viewer.userId))?.fullName ?? null;
    } catch {
      // Display-only — fall back to email initials rather than failing the page.
    }

    return { name, email: viewer.email ?? "" };
  }
);
