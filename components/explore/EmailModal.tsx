"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  EMAIL_CATEGORY_LABELS,
  ESP_LABELS,
  classifyListHeaders,
  type CapturedEmailDetail,
  type EmailCategory
} from "@/lib/admin-types";
import type { CollectionSummary } from "@/lib/collections-db";
import { countryFlag, countryName } from "@/lib/country";
import { formatFullDateTime } from "@/lib/datetime";
import type { ExploreEmailCard } from "@/lib/explore-db";
import {
  formatBytes,
  imageFormatLabel,
  type EmailImageStats,
  type ImageFormat
} from "@/lib/image-stats";
import AddToCollectionButton from "./AddToCollectionButton";
import { LOCKED_EMAIL_EVENT, LOCKED_EMAIL_FLAG } from "./SidebarNotices";
import styles from "./explore.module.css";

type ViewMode = "desktop" | "phone" | "text" | "html";

const VIEW_OPTIONS: { id: ViewMode; label: string }[] = [
  { id: "desktop", label: "Desktop" },
  { id: "phone", label: "Phone" },
  { id: "text", label: "Text" },
  { id: "html", label: "HTML" }
];

type Props = {
  email: ExploreEmailCard;
  onClose: () => void;
  /**
   * Base path for the rendered-preview iframe; the modal builds
   * `${renderUrlBase}/${id}/render`. Defaults to the entitlement-safe
   * public route; admin surfaces pass `/api/admin/emails`.
   */
  renderUrlBase?: string;
  /**
   * Base path for the email-detail fetch (metadata panel); builds
   * `${detailUrlBase}/${id}`. Defaults to the public route; admin
   * surfaces pass `/api/admin/emails`.
   */
  detailUrlBase?: string;
  /**
   * Read-only modal (public teaser): hides the account actions (Follow /
   * Save / Add-to-collection / Download) and the raw-HTML source tab. The
   * full metadata panel still renders.
   */
  readOnly?: boolean;
  /**
   * Whether the email is currently saved by the viewing user. Drives
   * the bookmark icon's filled / outline state and the active styling
   * on the right-pane action button.
   */
  isSaved?: boolean;
  /**
   * Toggle handler — parent owns the optimistic state + API call so the
   * modal stays in sync with the card grid behind it.
   */
  onToggleSave?: (email: ExploreEmailCard, next: boolean) => Promise<void> | void;
  /**
   * User's full collections list, plus this email's current
   * memberships and toggle/create handlers. Optional so existing call
   * sites (and the public share view) can keep using the modal
   * without the collections feature.
   */
  collections?: CollectionSummary[];
  membershipIds?: Set<string>;
  onToggleCollection?: (
    collectionId: string,
    emailId: string,
    next: boolean
  ) => Promise<void> | void;
  onCreateCollection?: (
    name: string,
    emailId: string
  ) => Promise<CollectionSummary | null>;
  onRequestMemberships?: (emailId: string) => Promise<void> | void;
};

/**
 * Full-screen email viewer that opens from the Explore grid. Renders the
 * stored email at desktop or phone widths via the existing
 * `/api/admin/emails/[id]/render` endpoint, plus a raw HTML view that pulls
 * `htmlContent` from `/api/admin/emails/[id]`. The right-hand metadata panel
 * surfaces every signal we currently track for an email so the user can
 * inspect classification, ESP, branding, deliverability, etc. without
 * leaving the modal.
 */
export default function EmailModal({
  email,
  onClose,
  renderUrlBase = "/api/explore/emails",
  detailUrlBase = "/api/public/emails",
  readOnly = false,
  isSaved = false,
  onToggleSave,
  collections,
  membershipIds,
  onToggleCollection,
  onCreateCollection,
  onRequestMemberships
}: Props) {
  const collectionsEnabled =
    !readOnly &&
    Array.isArray(collections) &&
    typeof onToggleCollection === "function" &&
    typeof onCreateCollection === "function";
  // The raw-HTML source tab is hidden in read-only (public) mode.
  const viewOptions = readOnly
    ? VIEW_OPTIONS.filter((option) => option.id !== "html")
    : VIEW_OPTIONS;
  const [view, setView] = useState<ViewMode>("desktop");
  const [detail, setDetail] = useState<CapturedEmailDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  // Single per-modal pending flag, since the only async action surfaced
  // from this view is the Save toggle. We use it to disable the button
  // while the round-trip is in flight so rapid double-clicks don't
  // fire competing PUT + DELETE requests.
  const [savePending, setSavePending] = useState(false);

  // Read-only means the viewer is on the link-stripped preview — flag it
  // so the sidebar's usage card can pitch links/source as the upgrade
  // hook for the rest of the session.
  useEffect(() => {
    if (!readOnly || typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(LOCKED_EMAIL_FLAG, "1");
    } catch {
      // Storage blocked — the event below still updates a mounted sidebar.
    }
    window.dispatchEvent(new Event(LOCKED_EMAIL_EVENT));
  }, [readOnly]);

  async function handleToggleSave() {
    if (savePending || !onToggleSave) return;
    setSavePending(true);
    try {
      await onToggleSave(email, !isSaved);
    } finally {
      setSavePending(false);
    }
  }

  // Lock body scroll while the modal is open so the page underneath
  // doesn't drift around when the user scrolls inside the email iframe.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    fetch(`${detailUrlBase}/${email.id}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed (${res.status})`);
        }
        const body = (await res.json()) as { email: CapturedEmailDetail };
        if (!cancelled) {
          setDetail(body.email);
          setDetailLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setDetailError(err instanceof Error ? err.message : "Failed to load");
          setDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [email.id, detailUrlBase]);

  const renderUrl = `${renderUrlBase}/${email.id}/render`;

  const htmlSize = useMemo(() => {
    if (!detail?.htmlContent) return null;
    return new Blob([detail.htmlContent]).size;
  }, [detail?.htmlContent]);

  const primaryFonts = useMemo(() => {
    if (!detail) return [] as string[];
    return [...detail.fontFamilies]
      .filter((font) => font.primary_count > 0)
      .sort((a, b) => b.primary_count - a.primary_count)
      .slice(0, 3)
      .map((font) => font.family);
  }, [detail]);

  const compliance = useMemo(
    () => (detail ? classifyListHeaders(detail.listHeaders) : null),
    [detail]
  );

  const dateLabel = useMemo(() => formatLongDate(email.receivedAt), [email.receivedAt]);

  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`${email.companyName} — ${email.subject}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className={styles.modalDialog}>
        <div className={styles.modalPreview}>
          <div className={styles.modalToolbar}>
            <div className={styles.viewToggle} role="tablist" aria-label="Preview mode">
              {viewOptions.map((option) => {
                const active = view === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`${styles.viewToggleButton}${
                      active ? ` ${styles.viewToggleButtonActive}` : ""
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
              className={styles.modalClose}
              onClick={onClose}
              aria-label="Close preview"
            >
              <CloseIcon />
            </button>
          </div>

          <div className={styles.modalStage}>
            {view === "html" ? (
              <HtmlCodeView
                html={detail?.htmlContent ?? ""}
                loading={detailLoading}
                error={detailError}
              />
            ) : view === "text" ? (
              <PlainTextView
                html={detail?.htmlContent ?? ""}
                loading={detailLoading}
                error={detailError}
              />
            ) : (
              <div
                className={`${styles.previewFrameWrap} ${
                  view === "phone" ? styles.previewFrameWrapPhone : styles.previewFrameWrapDesktop
                }`}
              >
                <iframe
                  src={renderUrl}
                  title={`${email.companyName} — ${email.subject}`}
                  className={styles.previewFrame}
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                />
              </div>
            )}
          </div>
        </div>

        <aside className={styles.modalInfo}>
          <InfoPanel
            email={email}
            detail={detail}
            detailLoading={detailLoading}
            detailError={detailError}
            htmlSize={htmlSize}
            primaryFonts={primaryFonts}
            compliance={compliance}
            dateLabel={dateLabel}
            readOnly={readOnly}
            isSaved={isSaved}
            savePending={savePending}
            onToggleSave={handleToggleSave}
            collectionsEnabled={collectionsEnabled}
            collections={collections}
            membershipIds={membershipIds}
            onToggleCollection={onToggleCollection}
            onCreateCollection={onCreateCollection}
            onRequestMemberships={onRequestMemberships}
          />
        </aside>
      </div>
    </div>
  );
}

type InfoPanelProps = {
  email: ExploreEmailCard;
  detail: CapturedEmailDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  htmlSize: number | null;
  primaryFonts: string[];
  compliance: ReturnType<typeof classifyListHeaders> | null;
  dateLabel: string;
  readOnly: boolean;
  isSaved: boolean;
  savePending: boolean;
  onToggleSave: () => void;
  collectionsEnabled: boolean;
  collections?: CollectionSummary[];
  membershipIds?: Set<string>;
  onToggleCollection?: (
    collectionId: string,
    emailId: string,
    next: boolean
  ) => Promise<void> | void;
  onCreateCollection?: (
    name: string,
    emailId: string
  ) => Promise<CollectionSummary | null>;
  onRequestMemberships?: (emailId: string) => Promise<void> | void;
};

function InfoPanel({
  email,
  detail,
  detailLoading,
  detailError,
  htmlSize,
  primaryFonts,
  compliance,
  dateLabel,
  readOnly,
  isSaved,
  savePending,
  onToggleSave,
  collectionsEnabled,
  collections,
  membershipIds,
  onToggleCollection,
  onCreateCollection,
  onRequestMemberships
}: InfoPanelProps) {
  // Follow toggle for the email's brand. Seeded from the server on open
  // (the modal carries no follow info up front) and written through the
  // shared `brand_follows` endpoints, so it stays in sync with the brand
  // page's own Follow button. Skipped on the read-only teaser and for
  // legacy emails with no matched company.
  const followCompanyId = email.companyId;
  const [following, setFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);

  useEffect(() => {
    if (readOnly || !followCompanyId) return;
    let cancelled = false;
    fetch(`/api/brand-follows/${encodeURIComponent(followCompanyId)}`, {
      credentials: "include"
    })
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { following?: boolean };
        if (!cancelled) setFollowing(Boolean(body.following));
      })
      .catch(() => {
        // Leave the default ("Follow") on failure — the toggle still works.
      });
    return () => {
      cancelled = true;
    };
  }, [readOnly, followCompanyId]);

  async function handleToggleFollow() {
    if (followPending || !followCompanyId) return;
    const next = !following;
    setFollowPending(true);
    setFollowing(next);
    try {
      const res = await fetch(
        `/api/brand-follows/${encodeURIComponent(followCompanyId)}`,
        { method: next ? "PUT" : "DELETE", credentials: "include" }
      );
      if (!res.ok) setFollowing(!next);
    } catch {
      setFollowing(!next);
    } finally {
      setFollowPending(false);
    }
  }

  const categoryLabel =
    EMAIL_CATEGORY_LABELS[email.category as EmailCategory] ?? email.category;
  const espLabel = detail?.espProvider ? ESP_LABELS[detail.espProvider] : null;

  // The pill row is a "what is this email?" summary at a glance — every
  // entry is a categorical attribute that fits in one or two words. Tone
  // is reserved for things the eye should jump to (offer + promo); the
  // rest stay neutral so the strip doesn't turn into a rainbow.
  const pills: { key: string; label: string; tone: PillTone }[] = [
    { key: "category", label: categoryLabel, tone: "neutral" }
  ];
  if (detail?.subcategory) {
    pills.push({ key: "subcategory", label: detail.subcategory, tone: "neutral" });
  }
  if (espLabel) {
    pills.push({ key: "esp", label: espLabel, tone: "neutral" });
  }
  if (email.discountPercent !== null) {
    pills.push({
      key: "discount",
      label: `${Math.round(email.discountPercent)}% off`,
      tone: "bad"
    });
  }
  if (email.hasGif) pills.push({ key: "gif", label: "GIF", tone: "neutral" });
  if (email.hasDarkMode) {
    pills.push({ key: "dark", label: "Dark mode", tone: "neutral" });
  }
  // Per-email detected market. This is usually the same as the brand's primary
  // market (and stays a quiet neutral pill), so the value is in the exception:
  // when an email targets a different country than the brand normally does, we
  // flag it (warn tone) — a multi-market send, or a detection worth reviewing.
  if (detail?.detectedCountry) {
    const brandMarket = detail.companyPrimaryMarketCountry;
    const diverges = !!brandMarket && brandMarket !== detail.detectedCountry;
    pills.push({
      key: "market",
      label: `${countryFlag(detail.detectedCountry)} ${countryName(
        detail.detectedCountry
      )}${diverges ? ` (brand: ${countryName(brandMarket)})` : ""}`,
      tone: diverges ? "warn" : "neutral"
    });
  }

  const hasOfferDetails =
    detail?.primaryCtaText ||
    detail?.primaryCtaUrl ||
    (detail?.discountAmount !== null && detail?.discountAmount !== undefined);

  return (
    <>
      {readOnly ? null : (
        <div className={styles.infoActions}>
          <button
            type="button"
            className={`${styles.infoActionPrimary}${
              following ? ` ${styles.infoActionPrimaryActive}` : ""
            }`}
            aria-pressed={following}
            disabled={followPending || !followCompanyId}
            onClick={() => void handleToggleFollow()}
          >
            {following ? "Following" : "Follow"}
          </button>
          <button
            type="button"
            className={`${styles.infoActionIcon}${
              isSaved ? ` ${styles.infoActionIconSaved}` : ""
            }`}
            aria-label={isSaved ? "Remove from saved" : "Save email"}
            aria-pressed={isSaved}
            disabled={savePending}
            onClick={onToggleSave}
          >
            {isSaved ? <BookmarkFilledIcon /> : <BookmarkOutlineIcon />}
          </button>
          {collectionsEnabled ? (
            <AddToCollectionButton
              variant="icon"
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
      )}

      {/*
        Whole row is a link so it's keyboard-focusable and navigates to
        the per-brand dashboard at /brands/[id]. Falls back to a static
        button when we don't yet have a companyId (legacy emails before
        the company match landed).
      */}
      {email.companyId ? (
        <Link
          href={`/brands/${email.companySlug ?? email.companyId}`}
          className={styles.infoBrandRow}
          aria-label={`View ${email.companyName} dashboard`}
        >
          <CompanyAvatar
            name={email.companyName}
            logoUrl={email.companyLogoUrl}
          />
          <div className={styles.infoBrandText}>
            <div className={styles.infoBrandName}>{email.companyName}</div>
          </div>
          <span className={styles.infoBrandChevron} aria-hidden="true">
            <ChevronRightIcon />
          </span>
        </Link>
      ) : (
        <div
          className={styles.infoBrandRow}
          aria-label={`${email.companyName} details unavailable`}
        >
          <CompanyAvatar
            name={email.companyName}
            logoUrl={email.companyLogoUrl}
          />
          <div className={styles.infoBrandText}>
            <div className={styles.infoBrandName}>{email.companyName}</div>
          </div>
        </div>
      )}

      <div className={styles.infoHero}>
        <div className={styles.infoSubject}>
          {email.subject || "(no subject)"}
        </div>
        {email.preheader ? (
          <div className={styles.infoPreheader}>{email.preheader}</div>
        ) : null}
        <div className={styles.infoMeta}>{dateLabel}</div>
      </div>

      <div className={styles.pillRow}>
        {pills.map((pill) => (
          <Pill key={pill.key} tone={pill.tone}>
            {pill.label}
          </Pill>
        ))}
        {/*
          Interactive pill, kept out of the plain `pills` list: it carries a
          hover / focus tooltip explaining the preheader padding trick with a
          link into the Learn article, so it needs its own markup.
        */}
        {detail?.preheaderPadded ? (
          <span
            className={styles.trickPill}
            tabIndex={0}
            role="note"
            aria-label="Preview padding: this email follows its preview text with invisible characters, so inboxes show only the teaser the sender wrote."
          >
            Preview padding
            <InfoIcon />
            <span className={styles.trickTooltip} role="tooltip">
              This email follows its preview text with a run of{" "}
              <strong>invisible characters</strong>, so the inbox preview shows
              only the teaser the sender wrote and never bleeds into the body.{" "}
              <Link
                href="/learn/preheader-padding-trick"
                className={styles.trickTooltipLink}
              >
                Read how the trick works
              </Link>
            </span>
          </span>
        ) : null}
      </div>

      {detail && detail.sentToLists.length > 1 ? (
        <div className={styles.sentToBlock}>
          <span className={styles.sentToHeader}>
            <span className={styles.sentToLabel}>
              Sent to {detail.sentToLists.length} mailing lists
            </span>
            <span
              className={styles.sentToInfo}
              tabIndex={0}
              role="note"
              aria-label={`${email.companyName} sent this identical email to all ${detail.sentToLists.length} of these mailing lists. We've collapsed the duplicates into one.`}
            >
              <InfoIcon />
              <span className={styles.sentToTooltip} role="tooltip">
                <strong>{email.companyName}</strong> sent this identical email to
                all {detail.sentToLists.length}{" "}of these mailing lists.
                We&rsquo;ve collapsed the duplicates into one.
              </span>
            </span>
          </span>
          <div className={styles.sentToPills}>
            {detail.sentToLists.map((list) => (
              <Pill key={list.inboxId ?? list.label} tone="neutral">
                {list.label}
              </Pill>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.statGrid}>
        <Stat
          label="HTML size"
          value={
            htmlSize !== null
              ? formatBytes(htmlSize)
              : detailLoading
              ? "…"
              : "—"
          }
        />
        <Stat
          label="Images"
          value={
            detail
              ? `${detail.imageUrls.length}`
              : detailLoading
              ? "…"
              : "—"
          }
        />
        <Stat
          label="Image weight"
          value={
            detail?.imageStats
              ? formatBytes(detail.imageStats.total_bytes)
              : detailLoading
              ? "…"
              : "—"
          }
        />
        <Stat
          label="Formats"
          value={
            detail?.imageStats
              ? formatMixLabel(detail.imageStats)
              : detailLoading
              ? "…"
              : "—"
          }
        />
      </div>

      <Accordion title="Addresses">
        <InfoRow label="From" value={detail?.sender ?? "—"} mono />
      </Accordion>

      {hasOfferDetails ? (
        <Accordion title="Offer">
          {detail?.discountAmount !== null && detail?.discountAmount !== undefined ? (
            <InfoRow
              label="Amount"
              value={`${detail.discountAmount}${
                detail?.currency ? ` ${detail.currency}` : ""
              }`}
            />
          ) : null}
          {detail?.primaryCtaText ? (
            <InfoRow label="CTA" value={detail.primaryCtaText} />
          ) : null}
          {detail?.primaryCtaUrl ? (
            <InfoRow
              label="Link"
              value={
                <a
                  href={detail.primaryCtaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.infoLink}
                >
                  {detail.primaryCtaUrl}
                </a>
              }
              mono
            />
          ) : null}
        </Accordion>
      ) : null}

      <Accordion title="Design">
        {primaryFonts.length > 0 ? (
          <InfoRow label="Fonts" value={primaryFonts.join(", ")} />
        ) : null}
        {detail && detail.paletteColors.length > 0 ? (
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Palette</span>
            <div className={styles.paletteRow}>
              {detail.paletteColors.slice(0, 8).map((color) => (
                <span
                  key={color.hex}
                  className={styles.paletteSwatch}
                  style={{ background: color.hex }}
                  title={`${color.hex} (${color.count})`}
                />
              ))}
            </div>
          </div>
        ) : null}
        {primaryFonts.length === 0 &&
        (!detail || detail.paletteColors.length === 0) ? (
          <div className={styles.accordionEmpty}>No design data captured.</div>
        ) : null}
      </Accordion>

      {detail?.imageStats && detail.imageStats.image_count > 0 ? (
        <Accordion title="Images">
          <div className={styles.pillRow}>
            {sortedFormatEntries(detail.imageStats).map(([format, bucket]) => (
              <Pill key={format} tone="neutral">
                {bucket.count} {imageFormatLabel(format)}
              </Pill>
            ))}
          </div>
          {detail.imageStats.assets.map((asset) => {
            const signedUrl = detail.imageSignedUrls.find(
              (item) => item.storagePath === asset.path
            )?.signedUrl;
            return (
              <div key={asset.path} className={styles.imageAssetRow}>
                {signedUrl ? (
                  <img
                    src={signedUrl}
                    alt=""
                    loading="lazy"
                    className={styles.imageAssetThumb}
                  />
                ) : (
                  <span className={styles.imageAssetThumbFallback} aria-hidden="true" />
                )}
                <span className={styles.imageAssetSize}>
                  {formatBytes(asset.bytes)}
                </span>
                <Pill tone="neutral">{imageFormatLabel(asset.format)}</Pill>
              </div>
            );
          })}
        </Accordion>
      ) : null}

      {detail?.authResults ? (
        <Accordion title="Authentication">
          <InfoRow
            label="SPF"
            value={<AuthBadge result={detail.authResults.spf} />}
          />
          <InfoRow
            label="DKIM"
            value={<AuthBadge result={detail.authResults.dkim} />}
          />
          <InfoRow
            label="DMARC"
            value={<AuthBadge result={detail.authResults.dmarc} />}
          />
        </Accordion>
      ) : null}

      {compliance ? (
        <Accordion title="Deliverability">
          <InfoRow
            label="Unsubscribe"
            value={
              <Pill tone={complianceTone(compliance.level)}>
                {complianceLabel(compliance.level)}
              </Pill>
            }
          />
          <InfoRow
            label="Apple Mail"
            value={
              <Pill tone={compliance.apple_mail_button ? "good" : "bad"}>
                {compliance.apple_mail_button ? "Supported" : "Not supported"}
              </Pill>
            }
          />
          <InfoRow
            label="Gmail / Yahoo"
            value={
              <Pill tone={compliance.gmail_yahoo_one_click ? "good" : "bad"}>
                {compliance.gmail_yahoo_one_click ? "Supported" : "Not supported"}
              </Pill>
            }
          />
        </Accordion>
      ) : null}

      {detailError ? (
        <div className={styles.infoError}>
          Could not load full details: {detailError}
        </div>
      ) : null}
    </>
  );
}

/**
 * Brand avatar shown next to the company name in the right pane. Uses the
 * brand's stored logo when we have one (extracted from a previous email
 * by the ingest pipeline) and falls back to a monogram of the first
 * letter when the logo is missing or fails to load. Same visual footprint
 * either way so the row layout doesn't shift.
 */
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
    <span className={styles.infoBrandAvatar} aria-hidden="true">
      {showLogo ? (
        <img
          src={logoUrl as string}
          alt=""
          className={styles.infoBrandLogo}
          onError={() => setErrored(true)}
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className={styles.infoBrandMonogramText}>
          {name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.statTile}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}

/**
 * Native `<details>`-based accordion. We get keyboard support, focus
 * management, and `Find in page` hits inside collapsed sections for free
 * — and there's no JS state to manage. The visual chrome (chevron rotate,
 * spacing) is all CSS.
 */
function Accordion({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className={styles.accordion}>
      <summary className={styles.accordionSummary}>
        <span className={styles.accordionTitle}>{title}</span>
        <ChevronDownIcon />
      </summary>
      <div className={styles.accordionBody}>{children}</div>
    </details>
  );
}

function HtmlCodeView({
  html,
  loading,
  error
}: {
  html: string;
  loading: boolean;
  error: string | null;
}) {
  const tokens = useMemo(() => (html ? tokenizeHtml(html) : []), [html]);

  if (loading) {
    return <div className={styles.codeMessage}>Loading HTML…</div>;
  }
  if (error) {
    return <div className={styles.codeMessage}>Failed to load HTML: {error}</div>;
  }
  if (!html) {
    return <div className={styles.codeMessage}>No HTML available.</div>;
  }
  return (
    <div className={styles.codeViewWrap}>
      <pre className={styles.codeView}>
        <code>
          {tokens.map((token, index) => (
            <span key={index} className={tokenClass(token.type)}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function PlainTextView({
  html,
  loading,
  error
}: {
  html: string;
  loading: boolean;
  error: string | null;
}) {
  const text = useMemo(() => (html ? htmlToPlainText(html) : ""), [html]);

  if (loading) {
    return <div className={styles.codeMessage}>Loading text…</div>;
  }
  if (error) {
    return <div className={styles.codeMessage}>Failed to load text: {error}</div>;
  }
  if (!text) {
    return <div className={styles.codeMessage}>No text content available.</div>;
  }
  return (
    <div className={styles.codeViewWrap}>
      <pre className={styles.textView}>{text}</pre>
    </div>
  );
}

/**
 * Render the readable copy of an email as plain text. Unlike the
 * one-line {@link stripHtml} used for indexing, this preserves the
 * vertical rhythm a reader expects: block elements and `<br>` become
 * line breaks, list items get a bullet, and links keep their visible
 * text. Style/script/head noise is dropped entirely.
 */
function htmlToPlainText(html: string): string {
  let text = html
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|table|h[1-6]|ul|ol|section|header|footer|article)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, " ");

  // Decode the handful of entities common in marketing copy.
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–");

  return text
    // Collapse runs of spaces/tabs but keep newlines intact.
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    // Cap consecutive blank lines at one.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type HtmlTokenType =
  | "comment"
  | "doctype"
  | "tag-bracket"
  | "tag-name"
  | "attr-name"
  | "attr-equals"
  | "attr-value"
  | "text";

type HtmlToken = { type: HtmlTokenType; text: string };

function tokenClass(type: HtmlTokenType): string {
  switch (type) {
    case "comment":
      return styles.codeComment;
    case "doctype":
      return styles.codeDoctype;
    case "tag-bracket":
      return styles.codeTagBracket;
    case "tag-name":
      return styles.codeTagName;
    case "attr-name":
      return styles.codeAttrName;
    case "attr-equals":
      return styles.codeAttrEquals;
    case "attr-value":
      return styles.codeAttrValue;
    default:
      return styles.codeText;
  }
}

/**
 * Lightweight HTML tokenizer good enough to drive a single-document
 * IDE-style highlighter. Handles comments, doctype/processing
 * instructions, opening / closing / self-closing tags, attributes with
 * single-, double-, or unquoted values, and free text.
 *
 * It deliberately doesn't try to be a full HTML parser — emails routinely
 * contain malformed markup, and a forgiving tokenizer keeps the view
 * usable instead of throwing.
 */
function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const n = html.length;
  let i = 0;

  while (i < n) {
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      const stop = end === -1 ? n : end + 3;
      tokens.push({ type: "comment", text: html.slice(i, stop) });
      i = stop;
      continue;
    }

    if (html[i] === "<" && (html[i + 1] === "!" || html[i + 1] === "?")) {
      const end = html.indexOf(">", i);
      const stop = end === -1 ? n : end + 1;
      tokens.push({ type: "doctype", text: html.slice(i, stop) });
      i = stop;
      continue;
    }

    if (html[i] === "<") {
      const tagEnd = findTagEnd(html, i);
      const stop = tagEnd === -1 ? n : tagEnd + 1;
      tokens.push(...tokenizeTag(html.slice(i, stop)));
      i = stop;
      continue;
    }

    const next = html.indexOf("<", i);
    const stop = next === -1 ? n : next;
    if (stop > i) {
      tokens.push({ type: "text", text: html.slice(i, stop) });
      i = stop;
    } else {
      i += 1;
    }
  }

  return tokens;
}

function findTagEnd(html: string, start: number): number {
  let i = start + 1;
  let inQuote: '"' | "'" | null = null;
  while (i < html.length) {
    const ch = html[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ">") {
      return i;
    }
    i += 1;
  }
  return -1;
}

function tokenizeTag(tag: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const n = tag.length;
  let i = 0;

  if (tag.startsWith("</")) {
    tokens.push({ type: "tag-bracket", text: "</" });
    i = 2;
  } else if (tag.startsWith("<")) {
    tokens.push({ type: "tag-bracket", text: "<" });
    i = 1;
  }

  let nameEnd = i;
  while (nameEnd < n && /[a-zA-Z0-9_:.\-]/.test(tag[nameEnd])) nameEnd += 1;
  if (nameEnd > i) {
    tokens.push({ type: "tag-name", text: tag.slice(i, nameEnd) });
    i = nameEnd;
  }

  while (i < n) {
    let ws = i;
    while (ws < n && /\s/.test(tag[ws])) ws += 1;
    if (ws > i) {
      tokens.push({ type: "text", text: tag.slice(i, ws) });
      i = ws;
    }
    if (i >= n) break;

    if (tag.startsWith("/>", i)) {
      tokens.push({ type: "tag-bracket", text: "/>" });
      i += 2;
      break;
    }
    if (tag[i] === ">") {
      tokens.push({ type: "tag-bracket", text: ">" });
      i += 1;
      break;
    }

    let attrEnd = i;
    while (attrEnd < n && !/[\s=>\/]/.test(tag[attrEnd])) attrEnd += 1;
    if (attrEnd > i) {
      tokens.push({ type: "attr-name", text: tag.slice(i, attrEnd) });
      i = attrEnd;
    }

    if (i < n && tag[i] === "=") {
      tokens.push({ type: "attr-equals", text: "=" });
      i += 1;
      if (i < n && (tag[i] === '"' || tag[i] === "'")) {
        const quote = tag[i];
        let valEnd = i + 1;
        while (valEnd < n && tag[valEnd] !== quote) valEnd += 1;
        if (valEnd < n) valEnd += 1;
        tokens.push({ type: "attr-value", text: tag.slice(i, valEnd) });
        i = valEnd;
      } else {
        let valEnd = i;
        while (valEnd < n && !/[\s>\/]/.test(tag[valEnd])) valEnd += 1;
        if (valEnd > i) {
          tokens.push({ type: "attr-value", text: tag.slice(i, valEnd) });
          i = valEnd;
        }
      }
    }

    if (i === ws && i < n) {
      tokens.push({ type: "text", text: tag[i] });
      i += 1;
    }
  }

  if (i < n) {
    tokens.push({ type: "text", text: tag.slice(i) });
  }

  return tokens;
}

function InfoRow({
  label,
  value,
  mono = false,
  muted = false
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={styles.infoRow}>
      <span className={styles.infoLabel}>{label}</span>
      <span
        className={`${styles.infoValue}${mono ? ` ${styles.infoValueMono}` : ""}${
          muted ? ` ${styles.infoValueMuted}` : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

type PillTone = "neutral" | "good" | "warn" | "bad";

function Pill({
  children,
  tone = "neutral"
}: {
  children: React.ReactNode;
  tone?: PillTone;
}) {
  return (
    <span className={`${styles.pill} ${styles[`pill_${tone}`]}`}>{children}</span>
  );
}

function AuthBadge({ result }: { result: string | null }) {
  if (!result) {
    return <span className={styles.infoValueMuted}>—</span>;
  }
  const lower = result.toLowerCase();
  const tone: PillTone = lower.includes("pass")
    ? "good"
    : lower.includes("fail")
    ? "bad"
    : lower.includes("none") || lower.includes("neutral")
    ? "warn"
    : "neutral";
  return <Pill tone={tone}>{result}</Pill>;
}

function complianceTone(
  level: ReturnType<typeof classifyListHeaders>["level"]
): PillTone {
  switch (level) {
    case "compliant":
      return "good";
    case "missing":
      return "bad";
    case "missing_post_header":
    case "missing_https_url":
    case "mailto_only":
      return "warn";
    case "unknown":
    default:
      return "neutral";
  }
}

function complianceLabel(
  level: ReturnType<typeof classifyListHeaders>["level"]
): string {
  switch (level) {
    case "compliant":
      return "RFC 8058";
    case "mailto_only":
      return "Mailto only";
    case "missing_post_header":
      return "Missing post header";
    case "missing_https_url":
      return "Missing https URL";
    case "missing":
      return "Not implemented";
    case "unknown":
    default:
      return "No headers";
  }
}

/** Format buckets sorted by usage, heaviest-used first. */
function sortedFormatEntries(
  stats: EmailImageStats
): [ImageFormat, { count: number; bytes: number }][] {
  return (
    Object.entries(stats.formats) as [
      ImageFormat,
      { count: number; bytes: number }
    ][]
  ).sort((a, b) => b[1].count - a[1].count);
}

/** Compact mix for the stat tile: "JPEG, PNG +1". */
function formatMixLabel(stats: EmailImageStats): string {
  const entries = sortedFormatEntries(stats);
  if (entries.length === 0) return "—";
  const top = entries.slice(0, 2).map(([format]) => imageFormatLabel(format));
  const rest = entries.length - top.length;
  return rest > 0 ? `${top.join(", ")} +${rest}` : top.join(", ");
}

function formatLongDate(value: string): string {
  return formatFullDateTime(value, { fallback: value });
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
  if (id === "phone") {
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
  if (id === "text") {
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
        <line x1="5" y1="7" x2="19" y2="7" />
        <line x1="5" y1="12" x2="19" y2="12" />
        <line x1="5" y1="17" x2="13" y2="17" />
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
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
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
      aria-hidden="true"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ChevronDownIcon() {
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
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ChevronRightIcon() {
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

function InfoIcon() {
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
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12" y2="8" />
    </svg>
  );
}
