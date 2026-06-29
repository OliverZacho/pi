"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import SupportChat from "./SupportChat";
import SupportFeedback from "./SupportFeedback";
import styles from "./HelpPane.module.css";

const UNREAD_POLL_INTERVAL_MS = 30000;

type HelpPaneProps = {
  /**
   * Trigger styling. "marketing" matches the public header's pill buttons;
   * "app" matches the white pill in the logged-in AppTopBar.
   */
  variant?: "marketing" | "app";
};

/**
 * "Need help?" button with a panel that flies in from the right.
 *
 * The panel is portalled to <body> so it positions against the viewport even
 * when an ancestor establishes a containing block (the AppTopBar uses a
 * `transform`, which would otherwise trap a `position: fixed` child). It closes
 * on Escape or a click outside both the trigger and the panel.
 *
 * Entries: Contact support (expands into the in-app chat), Share feedback
 * (expands into an inline feedback box), and quick Docs & help links.
 */
export default function HelpPane({ variant = "marketing" }: HelpPaneProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "chat" | "feedback">("menu");
  const [mounted, setMounted] = useState(false);
  const [unread, setUnread] = useState(0);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Poll for unread admin replies so the trigger shows a notification dot even
  // when the panel is closed. Logged-in only; a 401 just leaves the count at 0.
  const refreshUnread = useCallback(async () => {
    try {
      const response = await fetch("/api/support/chat?summary=1", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { unreadCount?: number };
      setUnread(data.unreadCount ?? 0);
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    void refreshUnread();
    const timer = setInterval(() => void refreshUnread(), UNREAD_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refreshUnread]);

  // Re-check unread when the panel opens, and return to the menu once closed.
  useEffect(() => {
    if (open) {
      void refreshUnread();
    } else {
      setView("menu");
    }
  }, [open, refreshUnread]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const triggerClass =
    variant === "app"
      ? `${styles.trigger} ${styles.triggerApp}`
      : styles.trigger;

  const menuContent = (
    <>
      <p className={styles.panelHeading}>How can we help?</p>

      <div className={styles.section}>
        <button
          type="button"
          className={styles.item}
          onClick={() => setView("chat")}
        >
          <svg className={styles.itemIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 5h16v11H8l-4 3.5V5Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          </svg>
          <span className={styles.itemBody}>
            <span className={styles.itemTitle}>Contact support</span>
            <span className={styles.itemDesc}>Chat with our team</span>
          </span>
          {unread > 0 ? (
            <span className={styles.itemDot} aria-label={`${unread} new reply`} />
          ) : (
            <svg className={styles.chevron} viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className={styles.item}
          onClick={() => setView("feedback")}
        >
          <svg className={styles.itemIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3.5 14.3 9l5.7.3-4.4 3.6 1.5 5.6L12 15.6 6.9 18.5l1.5-5.6L4 9.3 9.7 9 12 3.5Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
          <span className={styles.itemBody}>
            <span className={styles.itemTitle}>Share feedback</span>
            <span className={styles.itemDesc}>Suggest an idea or improvement</span>
          </span>
          <svg className={styles.chevron} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className={styles.divider} />

      <p className={styles.sectionLabel}>Docs &amp; help</p>
      <div className={styles.section}>
        <Link href="/learn" className={styles.item} onClick={() => setOpen(false)}>
          <svg className={styles.itemIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 4h9l3 3v13H6V4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M14 4v4h4" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
          <span className={styles.itemBody}>
            <span className={styles.itemTitle}>Learn</span>
          </span>
        </Link>

        <Link href="/tutorials" className={styles.item} onClick={() => setOpen(false)}>
          <svg className={styles.itemIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
            <path d="M10 9.5v5l4.5-2.5L10 9.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
          <span className={styles.itemBody}>
            <span className={styles.itemTitle}>Tutorials</span>
          </span>
        </Link>

        <Link href="/help" className={styles.item} onClick={() => setOpen(false)}>
          <svg className={styles.itemIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
            <path d="M9.7 9.5a2.4 2.4 0 0 1 4.6 0c0 1.6-2.3 1.9-2.3 3.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <circle cx="12" cy="16.4" r="0.5" fill="currentColor" stroke="currentColor" />
          </svg>
          <span className={styles.itemBody}>
            <span className={styles.itemTitle}>Help center</span>
          </span>
        </Link>
      </div>
    </>
  );

  const chatContent = (
    <>
      <div className={styles.chatHeader}>
        <button
          type="button"
          className={styles.chatBack}
          onClick={() => setView("menu")}
          aria-label="Back to help menu"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className={styles.chatTitle}>Contact support</span>
      </div>
      {view === "chat" ? <SupportChat onRead={() => setUnread(0)} /> : null}
    </>
  );

  const feedbackContent = (
    <>
      <div className={styles.chatHeader}>
        <button
          type="button"
          className={styles.chatBack}
          onClick={() => setView("menu")}
          aria-label="Back to help menu"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className={styles.chatTitle}>Share feedback</span>
      </div>
      {view === "feedback" ? <SupportFeedback /> : null}
    </>
  );

  const flushView = view === "chat" || view === "feedback";

  const panel = (
    <div
      ref={panelRef}
      className={
        open
          ? `${styles.panel} ${styles.open}${flushView ? ` ${styles.panelForm}` : ""}${view === "chat" ? ` ${styles.panelChat}` : ""}`
          : `${styles.panel}${flushView ? ` ${styles.panelForm}` : ""}${view === "chat" ? ` ${styles.panelChat}` : ""}`
      }
      role="dialog"
      aria-label="Help and support"
      aria-hidden={!open}
    >
      {view === "chat" ? chatContent : view === "feedback" ? feedbackContent : menuContent}
    </div>
  );

  return (
    <div className={styles.wrap} ref={triggerRef}>
      <button
        type="button"
        className={triggerClass}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tour="help-button"
      >
        <svg
          className={styles.triggerIcon}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M9.5 9.2a2.6 2.6 0 0 1 5 0c0 1.7-2.5 2-2.5 3.6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="12" cy="16.6" r="0.6" fill="currentColor" stroke="currentColor" />
        </svg>
        Need help?
        {unread > 0 ? <span className={styles.triggerDot} aria-hidden="true" /> : null}
      </button>

      {mounted && createPortal(panel, document.body)}
    </div>
  );
}
