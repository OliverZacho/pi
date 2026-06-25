"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import TrackedUpgradeLink from "@/components/common/TrackedUpgradeLink";
import type { SidebarNotice } from "@/lib/sidebar-notices";
import styles from "./explore.module.css";

/**
 * The sidebar footer notice slot (above the account row). Logged-out
 * viewers get the static "preview" card; signed-in viewers get the
 * highest-priority undismissed notice from `/api/notices` — the free
 * save-cap meter, a fulfilled brand request, a team join, or new mail
 * from followed brands. One card at a time, by design: the slot is a
 * status line, not a feed.
 */

const DISMISSED_KEY = "pirol:dismissed-notices";
const DISMISSED_CAP = 50;

/**
 * Set by EmailModal when a free viewer opens a link-stripped email this
 * session; the save-usage card swaps its muted line to a contextual
 * "links are paid" nudge. Event lets an already-mounted sidebar react.
 */
export const LOCKED_EMAIL_FLAG = "pirol:viewed-locked-email";
export const LOCKED_EMAIL_EVENT = "pirol:locked-email-viewed";

function readDismissed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

type Props = {
  signedIn: boolean;
};

export default function SidebarNotices({ signedIn }: Props) {
  const [notices, setNotices] = useState<SidebarNotice[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [lockedViewed, setLockedViewed] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    // Defer ~1.2s so this footer status line's (relatively slow) request
    // doesn't compete with the page's content + image requests during the
    // initial-load window. It's a status line, not first-paint content.
    const timer = window.setTimeout(() => {
      (async () => {
        try {
          const res = await fetch("/api/notices", {
            credentials: "include",
            signal: controller.signal
          });
          if (!res.ok) return;
          const body = (await res.json()) as { notices?: SidebarNotice[] };
          setNotices(Array.isArray(body.notices) ? body.notices : []);
        } catch {
          // Network hiccup — the slot just stays empty for this render.
        }
      })();
    }, 1200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [signedIn]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setLockedViewed(window.sessionStorage.getItem(LOCKED_EMAIL_FLAG) === "1");
    const onLockedViewed = () => setLockedViewed(true);
    window.addEventListener(LOCKED_EMAIL_EVENT, onLockedViewed);
    return () => window.removeEventListener(LOCKED_EMAIL_EVENT, onLockedViewed);
  }, []);

  if (!signedIn) {
    return (
      <div className={styles.usageCard}>
        <div className={styles.usageHeader}>
          <span className={styles.usageDot} aria-hidden="true" />
          <div className={styles.usageText}>
            You&apos;re on a preview
            <span className={styles.usageMuted}>
              Subscribe to unlock everything
            </span>
          </div>
        </div>
        <TrackedUpgradeLink source="sidebar_notice" className={styles.upgradeButton}>
          View plans
        </TrackedUpgradeLink>
      </div>
    );
  }

  const notice = notices.find((n) => !dismissed.includes(n.id));
  if (!notice) return null;

  // Fade the card out, then drop it from the slot. The dismissal is written
  // to localStorage up front so a CTA click that navigates away keeps the
  // notice gone even if the component unmounts before the fade finishes.
  function dismiss(id: string) {
    try {
      const next = [...readDismissed().filter((entry) => entry !== id), id].slice(
        -DISMISSED_CAP
      );
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Storage full / blocked — the fade + state update below still hide it.
    }
    setLeavingId(id);
  }

  function finishDismiss(id: string) {
    setDismissed((current) =>
      current.includes(id) ? current : [...current, id]
    );
  }

  const progress = notice.progress ?? null;
  const remaining = progress
    ? Math.max(0, progress.limit - progress.count)
    : null;
  const atCap = remaining === 0;
  // Contextual nudge: after the user has hit a link-stripped email this
  // session, the usage card's muted line sells what upgrading unlocks
  // instead of repeating the generic line. Cap copy stays as-is — at
  // the cap the saves message is the stronger one.
  const detail =
    notice.kind === "save-usage" && lockedViewed && !atCap
      ? "Links & source code are paid features"
      : notice.detail;

  const fillClass = atCap
    ? `${styles.usageProgressFill} ${styles.usageProgressFillFull}`
    : remaining !== null && remaining <= 5
      ? `${styles.usageProgressFill} ${styles.usageProgressFillWarn}`
      : styles.usageProgressFill;

  const leaving = leavingId === notice.id;

  return (
    <div
      className={`${styles.usageCard}${leaving ? ` ${styles.usageCardLeaving}` : ""}`}
      role="status"
      onTransitionEnd={(e) => {
        if (leaving && e.propertyName === "opacity") finishDismiss(notice.id);
      }}
    >
      {notice.dismissible ? (
        <button
          type="button"
          className={styles.noticeDismiss}
          aria-label="Dismiss notification"
          onClick={() => dismiss(notice.id)}
        >
          <CloseIcon />
        </button>
      ) : null}
      <div className={styles.usageHeader}>
        <span className={styles.usageDot} aria-hidden="true" />
        <div className={styles.usageText}>
          {notice.title}
          {detail ? <span className={styles.usageMuted}>{detail}</span> : null}
        </div>
      </div>
      {progress ? (
        <div
          className={styles.usageProgress}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.limit}
          aria-valuenow={progress.count}
          aria-label="Free saves used"
        >
          <span
            className={fillClass}
            style={{
              width: `${Math.min(100, (progress.count / progress.limit) * 100)}%`
            }}
          />
        </div>
      ) : null}
      {notice.cta ? (
        <Link
          href={notice.cta.href}
          className={styles.upgradeButton}
          onClick={() => dismiss(notice.id)}
        >
          {notice.cta.label}
        </Link>
      ) : null}
    </div>
  );
}
