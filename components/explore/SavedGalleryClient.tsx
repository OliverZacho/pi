"use client";

import { useCallback, useMemo, useState } from "react";
import type { ExploreEmailCard } from "@/lib/explore-db";
import EmailCard from "./EmailCard";
import EmailModal from "./EmailModal";
import styles from "./explore.module.css";

type Props = {
  initialEmails: ExploreEmailCard[];
};

/**
 * Lightweight client wrapper for the /saved gallery. Reuses the same
 * `EmailCard` + `EmailModal` machinery as Explore so the visual
 * language is identical and there's only one place to maintain the
 * preview-frame logic.
 *
 * Saved gallery semantics:
 *   - Every card starts in the "saved" state (that's why it's here).
 *   - Tapping Save *un*-saves it; the row is removed from the grid
 *     locally so the gallery stays focused on the actual saved set.
 *   - We don't re-fetch on unsave — the optimistic removal IS the
 *     truth, and the next visit re-loads from the server anyway.
 */
export default function SavedGalleryClient({ initialEmails }: Props) {
  const [emails, setEmails] = useState<ExploreEmailCard[]>(initialEmails);
  const [openEmail, setOpenEmail] = useState<ExploreEmailCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOpenEmail = useCallback((email: ExploreEmailCard) => {
    setOpenEmail(email);
  }, []);

  const handleCloseEmail = useCallback(() => {
    setOpenEmail(null);
  }, []);

  const handleToggleSave = useCallback(
    async (email: ExploreEmailCard, next: boolean) => {
      // The gallery only ever surfaces saved items, so a toggle here
      // always means "remove from saved". Save the previous list so we
      // can roll back if the API call fails.
      if (next) return;
      const previous = emails;
      setEmails((current) => current.filter((item) => item.id !== email.id));
      try {
        const res = await fetch(`/api/explore/saved/${email.id}`, {
          method: "DELETE",
          credentials: "include"
        });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
      } catch (err) {
        setEmails(previous);
        setError(err instanceof Error ? err.message : "Failed to unsave");
      }
    },
    [emails]
  );

  // Quick reuse of the `Set` interface EmailCard expects for the saved
  // check; we keep it as a memo so the identity is stable across
  // renders even though every card is, by definition, saved.
  const savedIds = useMemo(
    () => new Set(emails.map((email) => email.id)),
    [emails]
  );

  return (
    <>
      {error ? (
        <div className={styles.resultError} role="alert">
          {error}
        </div>
      ) : null}

      {emails.length === 0 ? (
        <p className={styles.empty}>
          You haven&apos;t saved any emails yet. Hover over any card in
          Explore and tap Save to start building your gallery.
        </p>
      ) : (
        <div className={styles.grid}>
          {emails.map((email) => (
            <EmailCard
              key={email.id}
              email={email}
              onOpen={handleOpenEmail}
              isSaved={savedIds.has(email.id)}
              onToggleSave={handleToggleSave}
            />
          ))}
        </div>
      )}

      {openEmail ? (
        <EmailModal email={openEmail} onClose={handleCloseEmail} />
      ) : null}
    </>
  );
}
