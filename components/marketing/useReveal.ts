"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Scroll-reveal hook for the marketing home sections. Returns a ref to
 * attach to the section root and a boolean that flips to `true` once the
 * element scrolls into view. Callers gate a `data-reveal` attribute on it
 * so CSS can run entrance transitions (bars growing, dots popping, cards
 * rising) exactly once, when the section is actually seen.
 *
 * Degrades gracefully: if IntersectionObserver is missing, or the user
 * prefers reduced motion, we reveal immediately so nothing stays hidden.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(
  rootMargin = "0px 0px -12% 0px"
) {
  const ref = useRef<T | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion || typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin, threshold: 0.15 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, revealed } as const;
}
