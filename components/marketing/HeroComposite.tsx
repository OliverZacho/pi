"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import AnalysisPanel from "./AnalysisPanel";
import EmailPreview from "./EmailPreview";
import { HERO_ROTATION } from "@/lib/marketing/hero-data";
import styles from "./herocomposite.module.css";

// Time each newsletter sits on screen before the next one slides in.
// The analysis panel finishes its full reveal at ~5.1s, so 9s leaves
// a comfortable beat to read the result before rotation.
const ROTATION_INTERVAL_MS = 9000;

export default function HeroComposite() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef<number | null>(null);

  // Auto-rotate, but pause on hover, when the tab is hidden, or when
  // the user prefers reduced motion.
  useEffect(() => {
    if (paused) return;
    if (typeof window === "undefined") return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReduced) return;

    intervalRef.current = window.setInterval(() => {
      setIndex((i) => (i + 1) % HERO_ROTATION.length);
    }, ROTATION_INTERVAL_MS);

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [paused]);

  // Pause the rotation while the tab is hidden so we don't burn cycles
  // (and so a returning user sees the current email for the full beat
  // instead of catching the tail end of an animation).
  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const slot = HERO_ROTATION[index];

  return (
    <section
      className={styles.wrap}
      aria-labelledby="hero-title"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className={styles.grid}>
        <div className={styles.colLeft}>
          <div className={styles.scrollFrame}>
            {/* key remount re-runs the email card's entrance animation */}
            <EmailPreview key={`email-${slot.email.id}`} email={slot.email} />
          </div>
        </div>

        <div className={styles.colCenter}>
          {/* Two synchronized pulse dots that sit on the inner edge of
              each side panel — a subtle "live link" between them. */}
          <span
            className={`${styles.linkDot} ${styles.linkDotLeft}`}
            aria-hidden="true"
          />
          <span
            className={`${styles.linkDot} ${styles.linkDotRight}`}
            aria-hidden="true"
          />

          <div className={styles.centerInner}>
            <p className={styles.eyebrow}>Pirol</p>

            <h1 id="hero-title" className={styles.headline}>
              Your space
              <br />
              for brand
              <br />
              intelligence
            </h1>

            <p className={styles.subhead}>
              Every email, every drop, every logo — from the brands you’re
              tracking, connected and searchable in one place.
            </p>

            <div className={styles.ctaRow}>
              <Link href="#" className={styles.primaryBtn}>
                Sign up
              </Link>
              <Link href="#" className={styles.secondaryBtn}>
                Get a demo
              </Link>
            </div>

            <div
              className={styles.rotationDots}
              role="tablist"
              aria-label="Featured newsletters"
            >
              {HERO_ROTATION.map((s, i) => (
                <button
                  key={s.email.id}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  aria-label={`Show ${s.email.brand.name}`}
                  className={`${styles.rotationDot} ${
                    i === index ? styles.rotationDotActive : ""
                  }`}
                  onClick={() => setIndex(i)}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.colRight}>
          <AnalysisPanel
            key={`analysis-${slot.email.id}`}
            email={slot.email}
            analytics={slot.analytics}
          />
        </div>
      </div>
    </section>
  );
}
