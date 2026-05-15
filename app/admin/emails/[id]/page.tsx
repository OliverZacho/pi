"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import {
  EMAIL_CATEGORY_LABELS,
  type CapturedEmailDetail,
  type EmailCategory,
  type EspProvider
} from "@/lib/admin-types";

const CATEGORY_LABELS: Record<EmailCategory, string> = EMAIL_CATEGORY_LABELS;

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
  agillic: "Agillic"
};

type EmailTab = "inbox" | "raw";

const TAB_LABELS: Record<EmailTab, string> = {
  inbox: "Inbox view",
  raw: "Raw data"
};

const TABS: EmailTab[] = ["inbox", "raw"];

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleString();
}

function formatInboxDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function categoryLabel(slug: string): string {
  if (slug in CATEGORY_LABELS) {
    return CATEGORY_LABELS[slug as EmailCategory];
  }
  return slug;
}

function senderInitial(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "?";
  const character = trimmed.charAt(0);
  return character.toUpperCase();
}

type DetailPageProps = {
  params: Promise<{ id: string }>;
};

export default function EmailDetailPage({ params }: DetailPageProps) {
  const { id } = use(params);
  const [email, setEmail] = useState<CapturedEmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<EmailTab>("inbox");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError("");
        const response = await fetch(`/api/admin/emails/${id}`, { cache: "no-store" });
        const body = (await response.json()) as { email?: CapturedEmailDetail; error?: string };
        if (cancelled) return;
        if (!response.ok || !body.email) {
          setError(body.error ?? "Failed to load email.");
          setEmail(null);
        } else {
          setEmail(body.email);
        }
      } catch {
        if (cancelled) return;
        setError("Failed to load email.");
        setEmail(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const renderUrl = email ? `/api/admin/emails/${email.id}/render` : null;

  const metadataDump = useMemo(() => {
    if (!email?.metadata) return null;
    return JSON.stringify(email.metadata, null, 2);
  }, [email?.metadata]);

  return (
    <main className="admin-page">
      <section className="header admin-header">
        <div>
          <Link href="/admin">&larr; Back to admin</Link>
          <h1>{email?.subject ?? "Email"}</h1>
          {email ? (
            <p>
              From <strong>{email.sender}</strong> to <code>{email.recipient}</code> &middot;{" "}
              received {formatDateTime(email.receivedAt)}
            </p>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
        </div>
        {email && email.imageSignedUrls.length > 0 ? (
          <a
            href={`/api/admin/emails/${email.id}/assets.zip`}
            className="sign-out"
            download
          >
            Download all assets (ZIP)
          </a>
        ) : null}
      </section>

      {loading ? <p>Loading...</p> : null}

      {email ? (
        <>
          <section className="card">
            <h2>Classification &amp; signals</h2>
            {email.paletteColors.length > 0 ? (
              <div className="palette-row" aria-label="Layout color palette">
                <span className="palette-label">Palette</span>
                <ul className="palette-swatches">
                  {email.paletteColors.map((color) => (
                    <li key={color.hex}>
                      <span
                        className="palette-swatch"
                        style={{ backgroundColor: color.hex }}
                        aria-hidden="true"
                      />
                      <code className="palette-hex">{color.hex}</code>
                      <span className="palette-count">{color.count}x</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <dl className="detail-grid">
              <div>
                <dt>Category</dt>
                <dd>{categoryLabel(email.category)}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>
                  {email.classificationSource} ({email.classificationConfidence.toFixed(2)})
                </dd>
              </div>
              <div>
                <dt>ESP</dt>
                <dd>
                  {email.espProvider ? (
                    <>
                      <span className="badge esp">{ESP_LABELS[email.espProvider]}</span>
                      {email.espConfidence !== null ? (
                        <span className="muted"> ({email.espConfidence.toFixed(2)})</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="dim">unknown</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Discount</dt>
                <dd>
                  {email.discountPercent !== null ? (
                    <span className="badge discount">
                      {Math.round(email.discountPercent)}% off
                    </span>
                  ) : email.discountAmount !== null ? (
                    <span className="badge discount">
                      {email.discountAmount} {email.currency ?? ""}
                    </span>
                  ) : (
                    <span className="dim">-</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Promo code</dt>
                <dd>
                  {email.promoCode ? (
                    <span className="badge promo">{email.promoCode}</span>
                  ) : (
                    <span className="dim">-</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Primary CTA</dt>
                <dd>
                  {email.primaryCtaText ? (
                    email.primaryCtaUrl ? (
                      <a href={email.primaryCtaUrl} target="_blank" rel="noreferrer">
                        {email.primaryCtaText}
                      </a>
                    ) : (
                      <span>{email.primaryCtaText}</span>
                    )
                  ) : (
                    <span className="dim">-</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Has GIF</dt>
                <dd>{email.hasGif ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Dark mode</dt>
                <dd>{email.hasDarkMode ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Sent at</dt>
                <dd>{formatDateTime(email.sentAt)}</dd>
              </div>
              <div>
                <dt>Processed at</dt>
                <dd>{formatDateTime(email.processedAt)}</dd>
              </div>
            </dl>
            {email.preheader ? (
              <p>
                <strong>Preheader:</strong> <em>{email.preheader}</em>
              </p>
            ) : null}
            {email.llmReasoning ? (
              <p>
                <strong>Model reasoning:</strong> {email.llmReasoning}
                {email.llmModel ? <span className="muted"> ({email.llmModel})</span> : null}
              </p>
            ) : null}
            {email.authResults ? (
              <p>
                <strong>Auth results:</strong> SPF {email.authResults.spf ?? "-"}, DKIM{" "}
                {email.authResults.dkim ?? "-"}, DMARC {email.authResults.dmarc ?? "-"}
              </p>
            ) : null}
          </section>

          <section className="card">
            <h2>Mirrored assets ({email.imageSignedUrls.length})</h2>
            {email.imageSignedUrls.length === 0 ? (
              <p>No images were mirrored for this email.</p>
            ) : (
              <div className="asset-gallery">
                {email.imageSignedUrls.map((asset) => {
                  const fileName = asset.storagePath.split("/").pop() ?? asset.storagePath;
                  return (
                    <figure key={asset.storagePath} className="asset-tile">
                      <a href={asset.signedUrl} target="_blank" rel="noreferrer">
                        <img src={asset.signedUrl} alt={fileName} loading="lazy" />
                      </a>
                      <figcaption>
                        <a href={asset.signedUrl} download={fileName}>
                          {fileName}
                        </a>
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            )}
          </section>

          <section className="card email-content-card">
            <div className="email-tabs" role="tablist" aria-label="Email content view">
              {TABS.map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  type="button"
                  aria-selected={activeTab === tab}
                  className={`email-tab${activeTab === tab ? " is-active" : ""}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
            </div>

            {activeTab === "inbox" ? (
              <div role="tabpanel" className="email-tab-panel">
                <div className="inbox-viewer">
                  <header className="inbox-viewer-header">
                    <div className="inbox-avatar" aria-hidden="true">
                      {senderInitial(email.companyName || email.sender)}
                    </div>
                    <div className="inbox-meta">
                      <h3 className="inbox-subject">{email.subject || "(no subject)"}</h3>
                      <div className="inbox-row">
                        <span className="inbox-from-name">
                          {email.companyName || email.sender}
                        </span>
                        <span className="inbox-from-address">&lt;{email.sender}&gt;</span>
                        <span className="inbox-date">{formatInboxDate(email.receivedAt)}</span>
                      </div>
                      <div className="inbox-row inbox-recipient">
                        <span className="muted">To</span>{" "}
                        <code className="inbox-recipient-address">{email.recipient}</code>
                      </div>
                      {email.preheader ? (
                        <div className="inbox-preheader">{email.preheader}</div>
                      ) : null}
                    </div>
                  </header>
                  {renderUrl ? (
                    <iframe
                      src={renderUrl}
                      title="Inbox preview"
                      sandbox="allow-popups allow-popups-to-escape-sandbox"
                      referrerPolicy="no-referrer"
                      className="email-preview-frame inbox-frame"
                    />
                  ) : null}
                </div>
              </div>
            ) : null}

            {activeTab === "raw" ? (
              <div role="tabpanel" className="email-tab-panel raw-tab-panel">
                <div className="raw-section">
                  <h3>Metadata JSON</h3>
                  {metadataDump ? (
                    <pre className="json-dump">{metadataDump}</pre>
                  ) : (
                    <p className="dim">No metadata recorded.</p>
                  )}
                </div>
                <div className="raw-section">
                  <div className="raw-section-header">
                    <h3>HTML source</h3>
                    {email.htmlSignedUrl ? (
                      <a
                        href={email.htmlSignedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="raw-source-link"
                      >
                        Open original .html &rarr;
                      </a>
                    ) : null}
                  </div>
                  {email.htmlContent ? (
                    <pre className="json-dump html-source">{email.htmlContent}</pre>
                  ) : (
                    <p className="dim">No HTML source stored for this email.</p>
                  )}
                </div>
                {email.remoteImageUrls.length > 0 ? (
                  <div className="raw-section">
                    <h3>Remote image URLs ({email.remoteImageUrls.length})</h3>
                    <ul className="remote-url-list">
                      {email.remoteImageUrls.map((url) => (
                        <li key={url}>
                          <a href={url} target="_blank" rel="noreferrer">
                            {url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
