"use client";

import { useEffect, useRef, useState } from "react";
import type { CollectionSummary } from "@/lib/collections-db";
import type { ExploreEmailCard } from "@/lib/explore-db";
import AddToCollectionButton from "./AddToCollectionButton";
import styles from "./explore.module.css";

const RENDER_WIDTH = 600;

type Props = {
  email: ExploreEmailCard;
  onOpen: (email: ExploreEmailCard) => void;
  /**
   * Whether the current user has already saved this email. Drives both
   * the Save button label ("Save" vs "Saved") and the pinned bookmark
   * indicator that shows even when the card is not hovered.
   */
  isSaved: boolean;
  /**
   * Toggle handler. Parent owns the optimistic state + API call so the
   * card stays a thin presentational component and Saved gallery state
   * can be lifted (and persisted) at the page level.
   */
  onToggleSave: (email: ExploreEmailCard, next: boolean) => Promise<void> | void;
  /**
   * User's full collections list. Passed down so the "Add to
   * collection" popover can render without firing its own request.
   * Optional so existing call sites (and the public share view, which
   * never has collections) can keep working unchanged.
   */
  collections?: CollectionSummary[];
  /** Collection ids that already contain this email. */
  membershipIds?: Set<string>;
  /**
   * Membership toggle. Parent does the API call (so it can update its
   * cached `membershipByEmail` map) and surfaces errors as toasts.
   */
  onToggleCollection?: (
    collectionId: string,
    emailId: string,
    next: boolean
  ) => Promise<void> | void;
  /** Create a new collection and add this email to it in one go. */
  onCreateCollection?: (
    name: string,
    emailId: string
  ) => Promise<CollectionSummary | null>;
  /** Pre-fetch membership for this email when the popover opens. */
  onRequestMemberships?: (emailId: string) => Promise<void> | void;
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
export default function EmailCard({
  email,
  onOpen,
  isSaved,
  onToggleSave,
  collections,
  membershipIds,
  onToggleCollection,
  onCreateCollection,
  onRequestMemberships
}: Props) {
  const collectionsEnabled =
    Array.isArray(collections) &&
    typeof onToggleCollection === "function" &&
    typeof onCreateCollection === "function";
  const previewRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Per-card pending state so we can disable the Save button while the
  // round-trip is in flight without blocking other cards on the grid.
  const [pendingSave, setPendingSave] = useState(false);

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

  async function handleToggleSave() {
    if (pendingSave) return;
    setPendingSave(true);
    try {
      await onToggleSave(email, !isSaved);
    } finally {
      setPendingSave(false);
    }
  }

  // The whole card is the click target (modern tile pattern). We use an
  // <article> with role="button" + tabIndex so keyboard users can still
  // focus and activate it, and inner buttons (Save, etc.) stop propagation
  // so they don't double-trigger the open action.
  return (
    <article
      className={styles.card}
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
      <div className={styles.cardPreview} ref={previewRef}>
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
        {isSaved ? (
          <span
            className={styles.cardSavedBadge}
            aria-label="Saved to your gallery"
            title="Saved"
          >
            <BookmarkFilledIcon />
          </span>
        ) : null}
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
            className={`${styles.overlayButton} ${
              isSaved ? styles.saved : styles.primary
            }`}
            onClick={(event) => {
              event.stopPropagation();
              void handleToggleSave();
            }}
            aria-pressed={isSaved}
            disabled={pendingSave}
          >
            {isSaved ? <BookmarkFilledIcon /> : <BookmarkOutlineIcon />}
            <span>{isSaved ? "Saved" : "Save"}</span>
          </button>
          {collectionsEnabled ? (
            <AddToCollectionButton
              variant="overlay"
              emailId={email.id}
              collections={collections ?? []}
              membershipIds={membershipIds ?? new Set()}
              onToggleCollection={onToggleCollection!}
              onCreateCollection={onCreateCollection!}
              onRequestMemberships={onRequestMemberships}
              align="right"
            />
          ) : null}
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

function BookmarkOutlineIcon() {
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
      className={styles.overlayIcon}
      aria-hidden="true"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function BookmarkFilledIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={styles.overlayIcon}
      aria-hidden="true"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}
