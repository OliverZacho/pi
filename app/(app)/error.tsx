"use client";

import { useEffect } from "react";
import Link from "next/link";
import SearchingLogo from "@/components/SearchingLogo";
import styles from "@/components/notFound.module.css";

/**
 * Error boundary for the logged-in app pages. Renders inside the app
 * layout, so the sidebar stays put and the user keeps their bearings
 * instead of hitting the hosting platform's bare error screen.
 */
export default function AppError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App page failed to render", error);
  }, [error]);

  return (
    <main className={styles.page}>
      <SearchingLogo className={styles.logo} />
      <p className={styles.code}>Something went wrong</p>
      <h1 className={styles.message}>
        This page hit a snag while loading. It is usually temporary, so give
        it another go.
      </h1>
      <button type="button" onClick={reset} className={styles.button}>
        Try again
      </button>
      <Link href="/explore" className={styles.quietLink}>
        Back to Explore
      </Link>
    </main>
  );
}
