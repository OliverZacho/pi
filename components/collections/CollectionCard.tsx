"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CollectionCardData } from "@/lib/collections-db";
import styles from "./collections.module.css";

const RENDER_WIDTH = 600;

type Props = {
  collection: CollectionCardData;
  /**
   * Builds the URL pointing the preview iframe at the correct render
   * endpoint. On `/collections` we use the admin-only render route;
   * the public `/c/[slug]` view passes a slug-scoped builder so an
   * anonymous viewer can still see the previews.
   */
  renderUrlFor: (emailId: string) => string;
  /**
   * Public share URL we copy to the user's clipboard when they press
   * Share. Always absolute so it works when the user pastes it
   * anywhere outside the app.
   */
  shareUrl: string;
  /**
   * Target for the Open button. For the owner-side grid this is
   * `/collections/[id]`; for the public share page we point readers
   * to the same `/c/[slug]` they came from (this prop is just unused
   * in that variant — every card simply navigates by anchor).
   */
  openHref: string;
  /** Entrance-animation delay so grid cards cascade in instead of
      appearing as one block. */
  enterDelayMs?: number;
};

/**
 * Single tile in the Collections grid. The visual headline is a 2×2
 * mosaic of the four most recent emails rendered in sandboxed iframes —
 * lifted from the Explore card pattern so the visual language stays
 * consistent. Hovering surfaces two pill actions: **Share** (copy link)
 * and **Open** (navigate to the collection).
 */
export default function CollectionCard({
  collection,
  renderUrlFor,
  shareUrl,
  openHref,
  enterDelayMs = 0
}: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  // Measure a single mosaic cell so we can scale each 600×600 iframe to
  // fill it exactly. Without this the iframes render in the top-left
  // corner of their cell with empty padding on the right/bottom — the
  // fixed media-query scales never quite match real cell widths once
  // sidebars and gaps eat into the available space.
  const mosaicRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  // Don't mount the four preview iframes until the card scrolls near the
  // viewport — each one pulls a full email render, so a long Collections
  // grid would otherwise fire dozens of them at once on first paint.
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const mosaicEl = mosaicRef.current;
    if (!mosaicEl) return;

    function recompute() {
      if (!mosaicEl) return;
      const firstCell = mosaicEl.querySelector<HTMLElement>(
        `.${styles.mosaicCell}`
      );
      const width = firstCell?.clientWidth ?? 0;
      if (width > 0) {
        setScale(width / RENDER_WIDTH);
      }
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(mosaicEl);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const mosaicEl = mosaicRef.current;
    if (!mosaicEl) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(mosaicEl);
    return () => io.disconnect();
  }, []);

  // Always render four slots so the mosaic doesn't reflow as a
  // collection grows past 4 entries. Empty slots get a placeholder
  // tile that matches the card's background instead of a broken
  // iframe.
  const slots = Array.from({ length: 4 }, (_, index) =>
    collection.previewEmailIds[index] ?? null
  );

  // LinkedIn-style "+N" overlay on the last tile once the collection
  // grows past the four preview slots. Captures the "there's more
  // behind this" cue without forcing us to actually render extra
  // iframes.
  const hiddenCount = Math.max(0, collection.emailCount - 4);

  const frameStyle =
    scale !== null
      ? {
          transform: `scale(${scale})`,
          width: `${RENDER_WIDTH}px`,
          height: `${RENDER_WIDTH}px`
        }
      : { visibility: "hidden" as const };

  async function handleShare(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setCopyError(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        // Fallback for older browsers — create a hidden textarea, select
        // the text, exec copy, then yank it.
        const textarea = document.createElement("textarea");
        textarea.value = shareUrl;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setCopyError(
        err instanceof Error ? err.message : "Couldn't copy link"
      );
    }
  }

  return (
    <article
      className={`${styles.card} ${styles.cardEnter}`}
      style={
        enterDelayMs > 0 ? { animationDelay: `${enterDelayMs}ms` } : undefined
      }
    >
      <Link href={openHref} className={styles.cardLink} aria-label={collection.name}>
        <div
          ref={mosaicRef}
          className={styles.mosaic}
          aria-hidden={collection.emailCount === 0}
        >
          {slots.map((emailId, index) => {
            const isLastTile = index === slots.length - 1;
            const showHiddenCount = isLastTile && hiddenCount > 0;
            return (
              <div key={index} className={styles.mosaicCell}>
                {emailId && inView ? (
                  <iframe
                    src={renderUrlFor(emailId)}
                    title=""
                    className={styles.mosaicFrame}
                    style={frameStyle}
                    loading="lazy"
                    sandbox="allow-popups allow-popups-to-escape-sandbox"
                    referrerPolicy="no-referrer"
                    tabIndex={-1}
                  />
                ) : (
                  <div className={styles.mosaicEmpty} />
                )}
                {showHiddenCount ? (
                  <div
                    className={styles.mosaicMore}
                    aria-label={`${hiddenCount} more ${
                      hiddenCount === 1 ? "email" : "emails"
                    }`}
                  >
                    <span className={styles.mosaicMoreLabel}>
                      +{hiddenCount}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
          {collection.emailCount === 0 ? (
            <div className={styles.emptyMessage}>Empty collection</div>
          ) : null}
        </div>
      </Link>

      <div className={styles.cardOverlay}>
        <button
          type="button"
          className={`${styles.overlayPill} ${
            copied ? styles.overlayPillCopied : ""
          }`}
          onClick={handleShare}
          aria-label={`Copy share link for ${collection.name}`}
          title="Copy share link"
        >
          <ShareIcon />
          <span>{copied ? "Copied" : "Share"}</span>
        </button>
        <Link
          href={openHref}
          className={`${styles.overlayPill} ${styles.overlayPillPrimary}`}
        >
          <OpenIcon />
          <span>Open</span>
        </Link>
      </div>

      <div className={styles.cardMeta}>
        <span className={styles.cardTitle} title={collection.name}>
          {collection.icon ? (
            <span className={styles.cardTitleIcon} aria-hidden="true">
              {collection.icon}
            </span>
          ) : null}
          {collection.name}
        </span>
        <span className={styles.cardCount}>
          {collection.emailCount === 1
            ? "1 email"
            : `${collection.emailCount} emails`}
        </span>
        {copyError ? (
          <span className={styles.copyError} role="alert">
            {copyError}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
      <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}
