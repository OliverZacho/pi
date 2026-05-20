"use client";

import { useCallback, useEffect, useState } from "react";
import EmailCard from "@/components/explore/EmailCard";
import EmailModal from "@/components/explore/EmailModal";
import exploreStyles from "@/components/explore/explore.module.css";
import type { ExploreEmailCard } from "@/lib/explore-db";

type Props = {
  emails: ExploreEmailCard[];
};

/**
 * Client-side island that renders the brand's most recent campaigns as
 * the same iframe-thumbnail cards used on the Explore grid, plus the
 * existing detail modal so users can click into a campaign without
 * leaving the dashboard.
 *
 * Splitting this out of the (server-rendered) brand dashboard keeps the
 * static analytics above it cacheable while still giving the grid the
 * stateful modal behaviour. Layout is borrowed from the Explore page so
 * the cards live in a familiar 4-up grid that gracefully falls back to
 * fewer columns on narrow viewports.
 *
 * The Save / Saved toggle wires into the same `/api/explore/saved`
 * endpoints as Explore. We pull the user's saved-id set on mount so
 * cards render with the right state without an extra prop drilling
 * through the (server-only) dashboard.
 */
export default function BrandRecentEmails({ emails }: Props) {
  const [openEmail, setOpenEmail] = useState<ExploreEmailCard | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());

  const handleOpen = useCallback((email: ExploreEmailCard) => {
    setOpenEmail(email);
  }, []);

  const handleClose = useCallback(() => {
    setOpenEmail(null);
  }, []);

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

  const handleToggleSave = useCallback(
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

  return (
    <>
      <div className={exploreStyles.grid}>
        {emails.map((email) => (
          <EmailCard
            key={email.id}
            email={email}
            onOpen={handleOpen}
            isSaved={savedIds.has(email.id)}
            onToggleSave={handleToggleSave}
          />
        ))}
      </div>
      {openEmail ? (
        <EmailModal email={openEmail} onClose={handleClose} />
      ) : null}
    </>
  );
}
