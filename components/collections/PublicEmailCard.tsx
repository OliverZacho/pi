"use client";

import { useEffect, useRef, useState } from "react";
import type { ExploreEmailCard } from "@/lib/explore-db";
import exploreStyles from "../explore/explore.module.css";

const RENDER_WIDTH = 600;

type Props = {
  email: ExploreEmailCard;
  onOpen: (email: ExploreEmailCard) => void;
  /**
   * Slug-scoped builder for the iframe `src`. Keeps the public render
   * endpoint distinct from the admin one; the membership check inside
   * the render route ensures only emails actually in this collection
   * are reachable.
   */
  renderUrlFor: (emailId: string) => string;
};

/**
 * Public-facing variant of `EmailCard`. Identical visual layout, but
 *  - reads its iframe `src` from the public render endpoint, and
 *  - drops the Save / Add-to-collection overlay (the visitor isn't
 *    necessarily signed in).
 *
 * Sharing the same CSS module keeps the cards visually identical to
 * the owner side, so the same collection feels consistent whether
 * you're the creator or a public visitor.
 */
export default function PublicEmailCard({
  email,
  onOpen,
  renderUrlFor
}: Props) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const previewEl = previewRef.current;
    if (!previewEl) return;

    function recompute() {
      const width = previewEl?.clientWidth ?? 0;
      if (width > 0) {
        setScale(width / RENDER_WIDTH);
      }
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(previewEl);
    return () => ro.disconnect();
  }, []);

  const frameStyle =
    scale !== null
      ? {
          transform: `scale(${scale})`,
          width: `${RENDER_WIDTH}px`,
          height: `${RENDER_WIDTH * 1.05}px`
        }
      : { visibility: "hidden" as const };

  function handleOpen() {
    onOpen(email);
  }

  return (
    <article
      className={exploreStyles.card}
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleOpen();
        }
      }}
      aria-label={`Open ${email.companyName} — ${email.subject || "email"}`}
    >
      <div className={exploreStyles.cardPreview} ref={previewRef}>
        {!loaded ? (
          <div className={exploreStyles.cardSkeleton} aria-hidden="true">
            Rendering preview…
          </div>
        ) : null}
        <iframe
          src={renderUrlFor(email.id)}
          title={`${email.companyName} — ${email.subject}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          className={exploreStyles.cardFrame}
          style={frameStyle}
          onLoad={() => setLoaded(true)}
        />
        <div className={exploreStyles.cardOverlay}>
          <button
            type="button"
            className={`${exploreStyles.overlayButton} ${exploreStyles.primary}`}
            onClick={(event) => {
              event.stopPropagation();
              handleOpen();
            }}
          >
            Open
          </button>
        </div>
      </div>

      <div className={exploreStyles.cardMeta}>
        <span className={exploreStyles.cardBrand}>{email.companyName}</span>
        <span className={exploreStyles.cardSubject}>
          {email.subject || "(no subject)"}
        </span>
        {email.discountPercent !== null ||
        email.hasGif ||
        email.hasDarkMode ? (
          <div className={exploreStyles.cardBadgeRow}>
            {email.discountPercent !== null ? (
              <span
                className={`${exploreStyles.cardBadge} ${exploreStyles.discount}`}
              >
                {Math.round(email.discountPercent)}% off
              </span>
            ) : null}
            {email.hasGif ? (
              <span className={exploreStyles.cardBadge}>GIF</span>
            ) : null}
            {email.hasDarkMode ? (
              <span className={exploreStyles.cardBadge}>Dark</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
