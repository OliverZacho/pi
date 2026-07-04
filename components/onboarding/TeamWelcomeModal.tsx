"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTour } from "./TourProvider";
import styles from "./team-welcome.module.css";

const FEATURES = [
  "The full email archive, with source links",
  "Unlimited saves and collections",
  "Brand comparisons, side by side",
  "Stats and analytics for every brand"
];

/**
 * One-shot welcome for a freshly invited team member, rendered on /explore
 * when the auth callback lands them with `?team_welcome=1` (set right after
 * their pending invite is claimed). Tells them who added them and what the
 * seat unlocks, and offers the guided tour — the "member" variant, since
 * their seat is already covered and there is no plan to choose.
 *
 * Easily dismissed (×, Esc, backdrop, or either button). Dismissing strips
 * the query param so a refresh or back-navigation doesn't re-show it.
 */
export default function TeamWelcomeModal({
  teamName,
  ownerName
}: {
  teamName: string;
  ownerName: string | null;
}) {
  const router = useRouter();
  const tour = useTour();
  const [open, setOpen] = useState(true);

  const dismiss = useCallback(() => {
    setOpen(false);
    router.replace("/explore", { scroll: false });
  }, [router]);

  function startTour() {
    dismiss();
    tour?.start({ variant: "member" });
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, dismiss]);

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="team-welcome-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div className={styles.modal}>
        <button
          type="button"
          className={styles.close}
          onClick={dismiss}
          aria-label="Close"
        >
          ×
        </button>
        <h2 id="team-welcome-title" className={styles.title}>
          Welcome to Pirol 👋
        </h2>
        <p className={styles.intro}>
          {ownerName ?? "A teammate"} added you to{" "}
          <strong>{teamName}</strong>. Your seat is covered by the team&apos;s
          plan, so everything is already unlocked for you:
        </p>
        <ul className={styles.features}>
          {FEATURES.map((feature) => (
            <li key={feature} className={styles.feature}>
              <svg className={styles.check} viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="m5 10 3.5 3.5L15 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {feature}
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={startTour}>
            Take the guided tour
          </button>
          <button type="button" className={styles.secondary} onClick={dismiss}>
            Start exploring on my own
          </button>
        </div>
      </div>
    </div>
  );
}
