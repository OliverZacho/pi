"use client";

import { useEffect, useState } from "react";
import { formatFullDateTime } from "@/lib/datetime";
import type { ExploreEmailCard } from "@/lib/explore-db";
import exploreStyles from "../explore/explore.module.css";

type ViewMode = "desktop" | "phone";

const VIEW_OPTIONS: { id: ViewMode; label: string }[] = [
  { id: "desktop", label: "Desktop" },
  { id: "phone", label: "Phone" }
];

type Props = {
  email: ExploreEmailCard;
  onClose: () => void;
  renderUrlFor: (emailId: string) => string;
};

/**
 * Slimmed `EmailModal` for the public share view. We drop the
 * admin-only metadata panel (ESP, design tokens, auth headers,
 * deliverability) and the HTML toggle (which would require pulling
 * the raw HTML from an admin endpoint). What's left is exactly what
 * the user signed up for when they shared the link: a clean,
 * read-only "look at this email" surface with Desktop / Phone
 * previews and the basics about the email.
 */
export default function PublicEmailModal({
  email,
  onClose,
  renderUrlFor
}: Props) {
  const [view, setView] = useState<ViewMode>("desktop");

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const dateLabel = formatFullDateTime(email.receivedAt, {
    fallback: email.receivedAt
  });

  return (
    <div
      className={exploreStyles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`${email.companyName} — ${email.subject}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className={exploreStyles.modalDialog}>
        <div className={exploreStyles.modalPreview}>
          <div className={exploreStyles.modalToolbar}>
            <div
              className={exploreStyles.viewToggle}
              role="tablist"
              aria-label="Preview mode"
            >
              {VIEW_OPTIONS.map((option) => {
                const active = view === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`${exploreStyles.viewToggleButton}${
                      active ? ` ${exploreStyles.viewToggleButtonActive}` : ""
                    }`}
                    onClick={() => setView(option.id)}
                  >
                    <ViewIcon id={option.id} />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={exploreStyles.modalClose}
              onClick={onClose}
              aria-label="Close preview"
            >
              <CloseIcon />
            </button>
          </div>

          <div className={exploreStyles.modalStage}>
            <div
              className={`${exploreStyles.previewFrameWrap} ${
                view === "phone"
                  ? exploreStyles.previewFrameWrapPhone
                  : exploreStyles.previewFrameWrapDesktop
              }`}
            >
              <iframe
                src={renderUrlFor(email.id)}
                title={`${email.companyName} — ${email.subject}`}
                className={exploreStyles.previewFrame}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>

        <aside className={exploreStyles.modalInfo}>
          <div className={exploreStyles.infoBrandRow}>
            <CompanyAvatar
              name={email.companyName}
              logoUrl={email.companyLogoUrl}
            />
            <div className={exploreStyles.infoBrandText}>
              <div className={exploreStyles.infoBrandName}>
                {email.companyName}
              </div>
            </div>
          </div>

          <div className={exploreStyles.infoHero}>
            <div className={exploreStyles.infoSubject}>
              {email.subject || "(no subject)"}
            </div>
            {email.preheader ? (
              <div className={exploreStyles.infoPreheader}>
                {email.preheader}
              </div>
            ) : null}
            <div className={exploreStyles.infoMeta}>{dateLabel}</div>
          </div>

          {email.discountPercent !== null ||
          email.promoCode ||
          email.hasGif ||
          email.hasDarkMode ? (
            <div className={exploreStyles.pillRow}>
              {email.discountPercent !== null ? (
                <span
                  className={`${exploreStyles.pill} ${exploreStyles.pill_bad}`}
                >
                  {Math.round(email.discountPercent)}% off
                </span>
              ) : null}
              {email.promoCode ? (
                <span
                  className={`${exploreStyles.pill} ${exploreStyles.pill_warn}`}
                >
                  {email.promoCode}
                </span>
              ) : null}
              {email.hasGif ? (
                <span
                  className={`${exploreStyles.pill} ${exploreStyles.pill_neutral}`}
                >
                  GIF
                </span>
              ) : null}
              {email.hasDarkMode ? (
                <span
                  className={`${exploreStyles.pill} ${exploreStyles.pill_neutral}`}
                >
                  Dark mode
                </span>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function CompanyAvatar({
  name,
  logoUrl
}: {
  name: string;
  logoUrl: string | null;
}) {
  const [errored, setErrored] = useState(false);
  const showLogo = Boolean(logoUrl) && !errored;
  return (
    <span className={exploreStyles.infoBrandAvatar} aria-hidden="true">
      {showLogo ? (
        <img
          src={logoUrl as string}
          alt=""
          className={exploreStyles.infoBrandLogo}
          onError={() => setErrored(true)}
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className={exploreStyles.infoBrandMonogramText}>
          {name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function ViewIcon({ id }: { id: ViewMode }) {
  if (id === "desktop") {
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
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    );
  }
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
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}
