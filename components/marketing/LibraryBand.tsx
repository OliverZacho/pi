"use client";

import Link from "next/link";
import { useReveal } from "./useReveal";
import { LibraryShowcase } from "./feature-visuals";
import styles from "./feature-bento.module.css";

/* =================================================================
   The library (Explore) — the ground floor the whole product sits
   on: the real filter row above a masonry of actual captured
   newsletters. Copy is one headline + two short lines; the visual
   carries the rest. Primary CTA = browse, same goal as the hero.
   ================================================================= */

export default function LibraryBand() {
  const { ref, revealed } = useReveal<HTMLElement>();

  return (
    <section
      ref={ref}
      data-reveal={revealed ? "in" : "out"}
      className={styles.band}
      aria-labelledby="library-title"
    >
      <div className={styles.library}>
        <div className={`${styles.libraryCopy} ${styles.reveal}`}>
          <p className={styles.eyebrow}>The library</p>
          <h2 id="library-title" className={styles.title}>
            Thousands of newsletters, all searchable.
          </h2>
          <p className={styles.libraryLede}>
            Every send, captured exactly as it landed. Filter by brand,
            colour, content type, or date.
          </p>
          <Link href="/explore" className={styles.libraryCta}>
            Browse the archive
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M5 12h14M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>

        <div className={styles.reveal}>
          <LibraryShowcase />
        </div>
      </div>
    </section>
  );
}
