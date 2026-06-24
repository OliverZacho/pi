"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CollectionSummary } from "@/lib/collections-db";
import { formatShortDate, formatTime } from "@/lib/datetime";
import type { ExploreEmailCard } from "@/lib/explore-db";
import AddToCollectionButton from "./AddToCollectionButton";
import styles from "./explore.module.css";

const RENDER_WIDTH = 600;

type Props = {
  email: ExploreEmailCard;
  onOpen: (email: ExploreEmailCard) => void;
  /**
   * Base path for the preview iframe's render endpoint; the card builds
   * `${renderUrlBase}/${id}/render`. Defaults to the entitlement-safe
   * public route (works for any viewer, links stripped); admin surfaces
   * pass `/api/admin/emails` to opt into the admin-gated render.
   */
  renderUrlBase?: string;
  /**
   * Read-only card (public teaser): hides the Save + Add-to-collection
   * controls regardless of whether handlers are passed.
   */
  readOnly?: boolean;
  /**
   * Whether the current user has already saved this email. Drives both
   * the Save button label ("Save" vs "Saved") and the pinned bookmark
   * indicator that shows even when the card is not hovered.
   */
  isSaved?: boolean;
  /**
   * Toggle handler. Parent owns the optimistic state + API call so the
   * card stays a thin presentational component and Saved gallery state
   * can be lifted (and persisted) at the page level.
   */
  onToggleSave?: (email: ExploreEmailCard, next: boolean) => Promise<void> | void;
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
  /**
   * Admin-only affordance. When true (and the email has a matched
   * company), a pinned star renders in the top-left corner so admins can
   * add / remove the brand from the Explore "Recommended" allowlist
   * (`companies.is_curated`) straight from the grid while browsing.
   */
  isAdmin?: boolean;
  /** Whether the email's brand is currently on the recommended allowlist. */
  isRecommended?: boolean;
  /**
   * Toggle the brand's recommended status. Parent owns the optimistic
   * state + PATCH so the star stays presentational and the whole grid
   * (every card from the same brand) updates together.
   */
  onToggleRecommended?: (companyId: string, next: boolean) => Promise<void> | void;
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
  renderUrlBase = "/api/explore/emails",
  readOnly = false,
  isSaved = false,
  onToggleSave,
  collections,
  membershipIds,
  onToggleCollection,
  onCreateCollection,
  onRequestMemberships,
  isAdmin = false,
  isRecommended = false,
  onToggleRecommended
}: Props) {
  const saveEnabled = !readOnly && typeof onToggleSave === "function";
  // Admins get the recommend star whenever the email is matched to a
  // company (no company ⇒ nothing to add to the allowlist).
  const recommendEnabled =
    isAdmin &&
    Boolean(email.companyId) &&
    typeof onToggleRecommended === "function";
  const collectionsEnabled =
    !readOnly &&
    Array.isArray(collections) &&
    typeof onToggleCollection === "function" &&
    typeof onCreateCollection === "function";
  const previewRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Off-screen cards must not mount their preview iframe — each one pulls
  // the full email and every image it references (the grid can be hundreds
  // of cards). `loading="lazy"` alone doesn't gate this reliably, so we
  // only attach the iframe `src` once the card scrolls within range. Until
  // then the skeleton shows and zero asset requests fire.
  const [inView, setInView] = useState(false);
  // Per-card pending state so we can disable the Save button while the
  // round-trip is in flight without blocking other cards on the grid.
  const [pendingSave, setPendingSave] = useState(false);
  // Same idea for the admin recommend star.
  const [pendingRecommend, setPendingRecommend] = useState(false);

  // "May 18 · 9:30 AM" — short date plus clock so the grid stays scannable
  // at a glance. Both pieces are zoned to the platform timezone via the
  // shared formatters so server and client agree byte-for-byte.
  const receivedLabel = useMemo(() => {
    const date = formatShortDate(email.receivedAt, { fallback: "" });
    const time = formatTime(email.receivedAt, { fallback: "" });
    if (date && time) return `${date} · ${time}`;
    return date || time || "";
  }, [email.receivedAt]);

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

  // Defer mounting the iframe until the card nears the viewport. The 600px
  // root margin starts the render just before it scrolls into view so the
  // preview is ready by the time the user sees it, without loading the
  // whole grid up front. Disconnect after the first hit — once loaded it
  // stays loaded.
  useEffect(() => {
    const previewEl = previewRef.current;
    if (!previewEl) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(previewEl);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const frame = frameRef.current;
    if (!frame) return;
    if (frame.contentDocument?.readyState === "complete") {
      setLoaded(true);
    }
  }, [inView]);

  const renderUrl = `${renderUrlBase}/${email.id}/render`;

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
    if (pendingSave || !onToggleSave) return;
    setPendingSave(true);
    try {
      await onToggleSave(email, !isSaved);
    } finally {
      setPendingSave(false);
    }
  }

  async function handleToggleRecommended() {
    if (pendingRecommend || !onToggleRecommended || !email.companyId) return;
    setPendingRecommend(true);
    try {
      await onToggleRecommended(email.companyId, !isRecommended);
    } finally {
      setPendingRecommend(false);
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
            {inView ? "Rendering preview…" : null}
          </div>
        ) : null}
        {inView ? (
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
        ) : null}
        {recommendEnabled ? (
          <button
            type="button"
            className={`${styles.cardRecommendStar}${
              isRecommended ? ` ${styles.cardRecommendStarOn}` : ""
            }`}
            onClick={(event) => {
              event.stopPropagation();
              void handleToggleRecommended();
            }}
            disabled={pendingRecommend}
            aria-pressed={isRecommended}
            aria-label={
              isRecommended
                ? `Remove ${email.companyName} from Recommended`
                : `Add ${email.companyName} to Recommended`
            }
            title={
              isRecommended
                ? "On the Recommended list — click to remove"
                : "Add this brand to Recommended"
            }
          >
            <StarIcon filled={isRecommended} />
          </button>
        ) : null}
        {saveEnabled && isSaved ? (
          <button
            type="button"
            className={styles.cardSavedBadge}
            onClick={(event) => {
              event.stopPropagation();
              void handleToggleSave();
            }}
            disabled={pendingSave}
            aria-label="Remove from your gallery"
            title="Click to unsave"
          >
            <BookmarkFilledIcon />
          </button>
        ) : null}
        {saveEnabled || collectionsEnabled ? (
          <div className={styles.cardOverlay}>
            {saveEnabled ? (
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
            ) : null}
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
        ) : null}
      </div>

      <div className={styles.cardMeta}>
        <span className={styles.cardBrand}>{email.companyName}</span>
        <span className={styles.cardSubject}>
          {email.subject || "(no subject)"}
        </span>
        {receivedLabel ? (
          <div className={styles.cardReceived}>
            <ClockIcon />
            <time dateTime={email.receivedAt}>{receivedLabel}</time>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l2.7 5.47 6.03.88-4.36 4.25 1.03 6.01L12 17.77 6.6 19.6l1.03-6.01-4.36-4.25 6.03-.88z" />
    </svg>
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
