"use client";

import { useEffect, useRef, useState } from "react";
import type { ExploreEmailCard } from "@/lib/explore-db";
import {
  PREVIEW_FRAME_SANDBOX,
  RENDER_WIDTH,
  subscribeToPreviewWidth
} from "@/lib/preview-width";
import exploreStyles from "../explore/explore.module.css";

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
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  // Width the email is rendered at before scaling. Starts at the 600px
  // default and widens to the document's natural width once it loads, so
  // wider layouts sit centred instead of showing only their left edge.
  const [renderWidth, setRenderWidth] = useState(RENDER_WIDTH);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const previewEl = previewRef.current;
    if (!previewEl) return;

    function recompute() {
      const width = previewEl?.clientWidth ?? 0;
      if (width > 0) {
        setPreviewWidth(width);
      }
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(previewEl);
    return () => ro.disconnect();
  }, []);

  // Same natural-width detection as EmailCard: the frame's embedded script
  // posts its width (see lib/preview-width.ts); we only ever widen.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    return subscribeToPreviewWidth(frame, (natural) => {
      setRenderWidth((current) => (natural > current ? natural : current));
    });
  }, []);

  const scale = previewWidth !== null ? previewWidth / renderWidth : null;

  const frameStyle =
    scale !== null
      ? {
          transform: `scale(${scale})`,
          width: `${renderWidth}px`,
          height: `${renderWidth * 1.05}px`
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
          ref={frameRef}
          src={renderUrlFor(email.id)}
          title={`${email.companyName} — ${email.subject}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox={PREVIEW_FRAME_SANDBOX}
          // Thumbnail only — without this the frame's overflowing document
          // paints a scrollbar on every card in Edge. See EmailCard.
          scrolling="no"
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
