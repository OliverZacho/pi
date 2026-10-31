"use client";

import Link from "next/link";
import { useHasSessionCookie } from "./useViewerDisplay";
import styles from "./newsletter-hero.module.css";

/**
 * The hero's "Log in" CTA, hidden for signed-in visitors. The page is static,
 * so `html[data-session]` hides it before hydration and the cookie check after.
 */
export default function HeroLoginLink() {
  const hasSession = useHasSessionCookie();
  if (hasSession) return null;

  return (
    <Link href="/login" className={`${styles.secondaryBtn} ${styles.guestOnly}`}>
      Log in
      <span className={styles.secondaryArrow} aria-hidden>
        →
      </span>
    </Link>
  );
}
