"use client";

import { useEffect, useMemo, useState } from "react";
import {
  EMAIL_CATEGORY_LABELS,
  classifyListHeaders,
  type CapturedEmailDetail,
  type EmailCategory,
  type EspProvider
} from "@/lib/admin-types";
import type { ExploreEmailCard } from "@/lib/explore-db";
import styles from "./explore.module.css";

const ESP_LABELS: Record<EspProvider, string> = {
  mailchimp: "Mailchimp",
  klaviyo: "Klaviyo",
  hubspot: "HubSpot",
  sendgrid: "SendGrid",
  braze: "Braze",
  iterable: "Iterable",
  customerio: "Customer.io",
  salesforce_mc: "Salesforce MC",
  marketo: "Marketo",
  omnisend: "Omnisend",
  activecampaign: "ActiveCampaign",
  constantcontact: "Constant Contact",
  drip: "Drip",
  attentive: "Attentive",
  sendinblue: "Brevo / Sendinblue",
  shopify_email: "Shopify Email",
  substack: "Substack",
  beehiiv: "beehiiv",
  convertkit: "ConvertKit / Kit",
  mailerlite: "MailerLite",
  mailgun: "Mailgun",
  postmark: "Postmark",
  amazon_ses: "Amazon SES",
  mailjet: "Mailjet",
  apsis: "APSIS / Efficy",
  agillic: "Agillic",
  peytzmail: "Peytzmail"
};

type ViewMode = "desktop" | "phone" | "html";

const VIEW_OPTIONS: { id: ViewMode; label: string }[] = [
  { id: "desktop", label: "Desktop" },
  { id: "phone", label: "Phone" },
  { id: "html", label: "HTML" }
];

type Props = {
  email: ExploreEmailCard;
  onClose: () => void;
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
export default function EmailModal({ email, onClose }: Props) {
  const [view, setView] = useState<ViewMode>("desktop");
  const [detail, setDetail] = useState<CapturedEmailDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);

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
    fetch(`/api/admin/emails/${email.id}`, { credentials: "include" })
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
  }, [email.id]);

  const renderUrl = `/api/admin/emails/${email.id}/render`;

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
              {VIEW_OPTIONS.map((option) => {
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
};

function InfoPanel({
  email,
  detail,
  detailLoading,
  detailError,
  htmlSize,
  primaryFonts,
  compliance,
  dateLabel
}: InfoPanelProps) {
  const categoryLabel =
    EMAIL_CATEGORY_LABELS[email.category as EmailCategory] ?? email.category;
  const espLabel = detail?.espProvider ? ESP_LABELS[detail.espProvider] : null;

  return (
    <>
      <div className={styles.infoActions}>
        <button type="button" className={styles.infoActionPrimary}>
          Follow
        </button>
        <button type="button" className={styles.infoActionIcon} aria-label="Add to folder">
          <FolderPlusIcon />
        </button>
        <button type="button" className={styles.infoActionIcon} aria-label="Download email">
          <DownloadIcon />
        </button>
      </div>

      <div className={styles.infoBrandRow}>
        <div className={styles.infoBrandMonogram} aria-hidden="true">
          {email.companyName.charAt(0).toUpperCase()}
        </div>
        <div className={styles.infoBrandText}>
          <div className={styles.infoBrandName}>{email.companyName}</div>
          {email.companyDomain ? (
            <a
              href={`https://${email.companyDomain}`}
              className={styles.infoBrandDomain}
              target="_blank"
              rel="noreferrer"
            >
              {email.companyDomain}
            </a>
          ) : null}
        </div>
      </div>

      <InfoSection title="Email">
        <InfoRow label="From" value={detail?.sender ?? "—"} mono />
        <InfoRow label="Subject" value={email.subject || "(no subject)"} />
        <InfoRow
          label="Preview"
          value={email.preheader || "—"}
          muted={!email.preheader}
        />
        <InfoRow label="Sent" value={dateLabel} />
        {detail?.recipient ? (
          <InfoRow label="To" value={detail.recipient} mono />
        ) : null}
      </InfoSection>

      <InfoSection title="Classification">
        <InfoRow label="Category" value={<Pill>{categoryLabel}</Pill>} />
        {detail?.subcategory ? (
          <InfoRow label="Subcategory" value={detail.subcategory} />
        ) : null}
        {detail ? (
          <InfoRow
            label="Source"
            value={`${detail.classificationSource}${
              detail.llmModel ? ` (${detail.llmModel})` : ""
            }`}
          />
        ) : null}
        {detail ? (
          <InfoRow
            label="Confidence"
            value={`${Math.round(detail.classificationConfidence * 100)}%`}
          />
        ) : null}
      </InfoSection>

      {(email.discountPercent !== null ||
        email.promoCode ||
        detail?.primaryCtaText ||
        detail?.primaryCtaUrl ||
        detail?.discountAmount) && (
        <InfoSection title="Offer">
          {email.discountPercent !== null ? (
            <InfoRow
              label="Discount"
              value={`${Math.round(email.discountPercent)}% off`}
            />
          ) : null}
          {detail?.discountAmount ? (
            <InfoRow
              label="Discount amount"
              value={`${detail.discountAmount}${
                detail.currency ? ` ${detail.currency}` : ""
              }`}
            />
          ) : null}
          {email.promoCode ? (
            <InfoRow
              label="Promo code"
              value={<code className={styles.promoChip}>{email.promoCode}</code>}
            />
          ) : null}
          {detail?.primaryCtaText ? (
            <InfoRow label="CTA" value={detail.primaryCtaText} />
          ) : null}
          {detail?.primaryCtaUrl ? (
            <InfoRow
              label="CTA URL"
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
        </InfoSection>
      )}

      <InfoSection title="Design">
        <InfoRow
          label="Fonts"
          value={primaryFonts.length > 0 ? primaryFonts.join(", ") : "—"}
          muted={primaryFonts.length === 0}
        />
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
        <InfoRow label="Has GIF" value={email.hasGif ? "Yes" : "No"} />
        <InfoRow label="Dark mode" value={email.hasDarkMode ? "Yes" : "No"} />
      </InfoSection>

      <InfoSection title="Tech">
        <InfoRow
          label="ESP"
          value={
            espLabel
              ? `${espLabel}${
                  detail?.espConfidence !== null && detail?.espConfidence !== undefined
                    ? ` (${Math.round(detail.espConfidence * 100)}%)`
                    : ""
                }`
              : detailLoading
              ? "…"
              : "Unknown"
          }
          muted={!espLabel}
        />
        <InfoRow
          label="HTML size"
          value={htmlSize !== null ? formatBytes(htmlSize) : detailLoading ? "…" : "—"}
        />
        <InfoRow
          label="Image size"
          value={
            detail
              ? `${detail.imageUrls.length} ${
                  detail.imageUrls.length === 1 ? "image" : "images"
                }`
              : detailLoading
              ? "…"
              : "—"
          }
        />
      </InfoSection>

      {detail?.authResults ? (
        <InfoSection title="Authentication">
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
        </InfoSection>
      ) : null}

      {compliance ? (
        <InfoSection title="Unsubscribe">
          <InfoRow
            label="Compliance"
            value={
              <Pill tone={complianceTone(compliance.level)}>
                {complianceLabel(compliance.level)}
              </Pill>
            }
          />
          <InfoRow
            label="Apple Mail"
            value={compliance.apple_mail_button ? "Yes" : "No"}
          />
          <InfoRow
            label="Gmail / Yahoo"
            value={compliance.gmail_yahoo_one_click ? "Yes" : "No"}
          />
          {detail?.listHeaders?.list_id ? (
            <InfoRow label="List-Id" value={detail.listHeaders.list_id} mono />
          ) : null}
        </InfoSection>
      ) : null}

      {detailError ? (
        <div className={styles.infoError}>
          Could not load full details: {detailError}
        </div>
      ) : null}
    </>
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

function InfoSection({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.infoSection}>
      <div className={styles.infoSectionTitle}>{title}</div>
      <div className={styles.infoSectionBody}>{children}</div>
    </section>
  );
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

function Pill({
  children,
  tone = "neutral"
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
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
  const tone: "good" | "warn" | "bad" | "neutral" = lower.includes("pass")
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
): "good" | "warn" | "bad" | "neutral" {
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatLongDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
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

function FolderPlusIcon() {
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
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

function DownloadIcon() {
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
