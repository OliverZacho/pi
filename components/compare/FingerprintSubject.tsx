"use client";

import { useCallback, useState } from "react";
import EmailModal from "@/components/explore/EmailModal";
import { formatShortDate } from "@/lib/datetime";
import type { ExploreEmailCard } from "@/lib/explore-db";
import styles from "./compare.module.css";

type Props = {
  /** The brand's latest sampled email, prebuilt server-side. */
  email: ExploreEmailCard;
};

/**
 * "Latest subject" row on a fingerprint card: a labelled, clickable
 * subject line that opens the email in the shared Explore modal.
 *
 * One instance mounts per brand card, so the saved-state lookup is
 * deferred to the first click and cached module-wide — twenty cards
 * cost zero requests until someone actually opens an email, and then
 * exactly one.
 */
export default function FingerprintSubject({ email }: Props) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleOpen = useCallback(() => {
    setOpen(true);
    void fetchSavedIds().then((ids) => setSaved(ids.has(email.id)));
  }, [email.id]);

  const handleToggleSave = useCallback(
    async (card: ExploreEmailCard, next: boolean) => {
      setSaved(next);
      updateSavedIdsCache(card.id, next);
      try {
        const res = await fetch(`/api/explore/saved/${card.id}`, {
          method: next ? "PUT" : "DELETE",
          credentials: "include"
        });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
      } catch {
        setSaved(!next);
        updateSavedIdsCache(card.id, !next);
      }
    },
    []
  );

  return (
    <>
      <button
        type="button"
        className={styles.fpSubjectButton}
        onClick={handleOpen}
        title="Open this email"
      >
        <span className={styles.fpSubjectText}>“{email.subject}”</span>
        <span className={styles.fpSubjectDate}>
          {formatShortDate(email.receivedAt)}
        </span>
      </button>
      {open ? (
        <EmailModal
          email={email}
          onClose={() => setOpen(false)}
          isSaved={saved}
          onToggleSave={handleToggleSave}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Shared saved-ids cache                                              */
/* ------------------------------------------------------------------ */

let savedIdsPromise: Promise<Set<string>> | null = null;

function fetchSavedIds(): Promise<Set<string>> {
  savedIdsPromise ??= fetch("/api/explore/saved?ids=1", {
    credentials: "include"
  })
    .then(async (res) => {
      if (!res.ok) return new Set<string>();
      const body = (await res.json()) as { ids?: string[] };
      return new Set(body.ids ?? []);
    })
    .catch(() => new Set<string>());
  return savedIdsPromise;
}

/** Keeps the cached set honest after a toggle so a second card's modal
 *  doesn't show a stale bookmark state. */
function updateSavedIdsCache(id: string, saved: boolean): void {
  if (!savedIdsPromise) return;
  void savedIdsPromise.then((ids) => {
    if (saved) ids.add(id);
    else ids.delete(id);
  });
}
