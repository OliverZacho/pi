"use client";

import type { ReactNode } from "react";
import { useReveal } from "./useReveal";
import styles from "./feature-bento.module.css";

/**
 * Wraps a feature page's large product miniature in a white poster card
 * and drives the same scroll-reveal animations the homepage tiles use
 * (the miniatures key their entrance transitions off an ancestor's
 * [data-reveal="in"]).
 */
export default function FeaturePoster({
  children,
  stack = false
}: {
  children: ReactNode;
  /** Lay multiple visuals out as a vertical stack inside one card. */
  stack?: boolean;
}) {
  const { ref, revealed } = useReveal<HTMLDivElement>();

  return (
    <div
      ref={ref}
      data-reveal={revealed ? "in" : "out"}
      className={styles.posterWrap}
    >
      <div
        className={`${styles.posterCard} ${styles.reveal} ${
          stack ? styles.posterStack : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}
