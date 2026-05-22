"use client";

import Link from "next/link";
import { useState } from "react";
import type { CollectionCardData } from "@/lib/collections-db";
import styles from "./collections.module.css";

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
  openHref
}: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  // Always render four slots so the mosaic doesn't reflow as a
  // collection grows past 4 entries. Empty slots get a placeholder
  // tile that matches the card's background instead of a broken
  // iframe.
  const slots = Array.from({ length: 4 }, (_, index) =>
    collection.previewEmailIds[index] ?? null
  );

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
    <article className={styles.card}>
      <Link href={openHref} className={styles.cardLink} aria-label={collection.name}>
        <div className={styles.mosaic} aria-hidden={collection.emailCount === 0}>
          {slots.map((emailId, index) => (
            <div key={index} className={styles.mosaicCell}>
              {emailId ? (
                <iframe
                  src={renderUrlFor(emailId)}
                  title=""
                  className={styles.mosaicFrame}
                  loading="lazy"
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                  tabIndex={-1}
                />
              ) : (
                <div className={styles.mosaicEmpty} />
              )}
            </div>
          ))}
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
