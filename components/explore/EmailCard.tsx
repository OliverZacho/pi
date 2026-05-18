"use client";

import { useEffect, useRef, useState } from "react";
import type { ExploreEmailCard } from "@/lib/explore-db";
import styles from "./explore.module.css";

const RENDER_WIDTH = 600;

type Props = {
  email: ExploreEmailCard;
  onOpen: (email: ExploreEmailCard) => void;
};

/**
 * Single Explore card. The thumbnail is the actual stored email rendered
 * inside an iframe at full width and visually scaled down with a CSS
 * transform — that keeps every fixed-width table / media query inside
 * the email layout intact, but lets us pack ~24 of them into a grid.
 *
 * If this becomes slow with hundreds of cards, the next step is to
 * pre-generate a PNG/AVIF thumbnail per email and swap the iframe for
 * an `<img>`. The DOM around the preview is intentionally identical to
 * what an `<img>`-based card would need.
 */
export default function EmailCard({ email, onOpen }: Props) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
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

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (frame.contentDocument?.readyState === "complete") {
      setLoaded(true);
    }
  }, []);

  const renderUrl = `/api/admin/emails/${email.id}/render`;

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
    <article className={styles.card}>
      <div
        role="button"
        tabIndex={0}
        className={styles.cardPreview}
        ref={previewRef}
        onClick={handleOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleOpen();
          }
        }}
        aria-label={`Open ${email.companyName} — ${email.subject || "email"}`}
      >
        {!loaded ? (
          <div className={styles.cardSkeleton} aria-hidden="true">
            Rendering preview…
          </div>
        ) : null}
        <iframe
          ref={frameRef}
          src={renderUrl}
          title={`${email.companyName} — ${email.subject}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          className={styles.cardFrame}
          style={frameStyle}
          onLoad={() => setLoaded(true)}
        />
        <div className={styles.cardOverlay}>
          <button
            type="button"
            className={styles.overlayButton}
            onClick={(event) => {
              event.stopPropagation();
              handleOpen();
            }}
          >
            Open
          </button>
          <button
            type="button"
            className={`${styles.overlayButton} ${styles.primary}`}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            Save
          </button>
        </div>
      </div>

      <div className={styles.cardMeta}>
        <span className={styles.cardBrand}>{email.companyName}</span>
        <span className={styles.cardSubject}>
          {email.subject || "(no subject)"}
        </span>
        {email.discountPercent !== null ||
        email.promoCode ||
        email.hasGif ||
        email.hasDarkMode ? (
          <div className={styles.cardBadgeRow}>
            {email.discountPercent !== null ? (
              <span className={`${styles.cardBadge} ${styles.discount}`}>
                {Math.round(email.discountPercent)}% off
              </span>
            ) : null}
            {email.promoCode ? (
              <span className={`${styles.cardBadge} ${styles.promo}`}>
                {email.promoCode}
              </span>
            ) : null}
            {email.hasGif ? <span className={styles.cardBadge}>GIF</span> : null}
            {email.hasDarkMode ? (
              <span className={styles.cardBadge}>Dark</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
