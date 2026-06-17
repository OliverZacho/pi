"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import FeatureRequestModal from "@/components/feedback/FeatureRequestModal";
import styles from "./HelpPane.module.css";

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
 * Entries: Contact support (→ /help), Share feedback (opens the existing
 * FeatureRequestModal), and quick Docs & help links.
 */
export default function HelpPane({ variant = "marketing" }: HelpPaneProps) {
  const [open, setOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  const panel = (
    <div
      ref={panelRef}
      className={open ? `${styles.panel} ${styles.open}` : styles.panel}
      role="dialog"
      aria-label="Help and support"
      aria-hidden={!open}
    >
      <p className={styles.panelHeading}>How can we help?</p>

      <div className={styles.section}>
        <Link href="/help" className={styles.item} onClick={() => setOpen(false)}>
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
            <span className={styles.itemDesc}>Get in touch with our team</span>
          </span>
          <svg className={styles.chevron} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>

        <button
          type="button"
          className={styles.item}
          onClick={() => {
            setOpen(false);
            setFeedbackOpen(true);
          }}
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
        <Link href="/docs" className={styles.item} onClick={() => setOpen(false)}>
          <svg className={styles.itemIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 4h9l3 3v13H6V4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M14 4v4h4" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
          <span className={styles.itemBody}>
            <span className={styles.itemTitle}>Documentation</span>
          </span>
        </Link>

        <Link href="/tutorials" className={styles.item} onClick={() => setOpen(false)}>
          <svg className={styles.itemIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M3 7.5 12 4l9 3.5L12 11 3 7.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M7 9.5V14c0 1.2 2.2 2.5 5 2.5s5-1.3 5-2.5V9.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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
      </button>

      {mounted && createPortal(panel, document.body)}

      {feedbackOpen && <FeatureRequestModal onClose={() => setFeedbackOpen(false)} />}
    </div>
  );
}
