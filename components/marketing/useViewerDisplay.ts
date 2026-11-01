"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getProfile } from "@/lib/profile-db";
import { useHasSessionCookie } from "@/lib/use-has-session-cookie";
import type { HeaderUser } from "./Header";

/**
 * The signed-in viewer for marketing chrome, resolved in the browser so the
 * pages themselves stay static. Returns `null` for guests, `undefined` while
 * a session cookie exists but the session is still being read.
 */
export function useViewerDisplay(): HeaderUser | null | undefined {
  const hasSession = useHasSessionCookie();
  const [user, setUser] = useState<HeaderUser | null | undefined>(undefined);

  useEffect(() => {
    if (!hasSession) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const sessionUser = data.session?.user;
        if (!sessionUser) {
          if (!cancelled) setUser(null);
          return;
        }
        let name: string | null = null;
        try {
          name = (await getProfile(supabase, sessionUser.id))?.fullName ?? null;
        } catch {
          // Display-only: fall back to email initials.
        }
        if (!cancelled) setUser({ name, email: sessionUser.email ?? "" });
      } catch {
        if (!cancelled) setUser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasSession]);

  return hasSession ? user : null;
}
