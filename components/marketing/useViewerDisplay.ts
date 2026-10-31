"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { getProfile } from "@/lib/profile-db";
import { hasSessionCookie } from "@/lib/session-hint";
import type { HeaderUser } from "./Header";

const noopSubscribe = () => () => {};

/**
 * Whether a session cookie exists. False during hydration (matching the
 * static HTML), the real answer straight after.
 */
export function useHasSessionCookie(): boolean {
  return useSyncExternalStore(noopSubscribe, hasSessionCookie, () => false);
}

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
