"use client";

import { useCallback, useEffect, useState } from "react";
import type { ExploreEmailCard } from "@/lib/explore-db";

/**
 * Shared client hook for the "Saved" toggle used by the brand dashboard's
 * email surfaces (the recent-campaigns grid and the discount timeline).
 *
 * Pulls the viewer's saved-id set once on mount so cards/dots render with
 * the right state, and exposes an optimistic toggle that rolls back if the
 * write fails. Wiring this once means both surfaces stay in sync with the
 * same `/api/explore/saved` endpoints without prop-drilling through the
 * (server-rendered) dashboard.
 */
export function useSavedEmails() {
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/explore/saved?ids=1", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json()) as { ids: string[] };
        return body.ids ?? [];
      })
      .then((ids) => {
        if (!cancelled && ids) {
          setSavedIds(new Set(ids));
        }
      })
      .catch(() => {
        /* Best-effort — cards default to unsaved if this fails. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSave = useCallback(
    async (email: ExploreEmailCard, next: boolean) => {
      setSavedIds((current) => {
        const updated = new Set(current);
        if (next) updated.add(email.id);
        else updated.delete(email.id);
        return updated;
      });
      try {
        const res = await fetch(`/api/explore/saved/${email.id}`, {
          method: next ? "PUT" : "DELETE",
          credentials: "include"
        });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
      } catch {
        setSavedIds((current) => {
          const updated = new Set(current);
          if (next) updated.delete(email.id);
          else updated.add(email.id);
          return updated;
        });
      }
    },
    []
  );

  return { savedIds, toggleSave };
}
