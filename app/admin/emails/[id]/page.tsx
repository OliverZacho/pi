"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { CapturedEmailDetail, EmailCategory, EspProvider } from "@/lib/admin-types";

const CATEGORY_LABELS: Record<EmailCategory, string> = {
  sale: "Sale / Discount",
  product_launch: "Product / Service launch",
  event: "Event / Invite",
  content: "Content / Editorial",
  loyalty: "Loyalty / Retention",
  transactional: "Transactional",
  seasonal: "Seasonal / Campaign",
  partnership: "Collaboration / Partnership",
  company_news: "Company news",
  other: "Other"
};

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
  mailjet: "Mailjet"
};

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

function categoryLabel(slug: string): string {
  if (slug in CATEGORY_LABELS) {
    return CATEGORY_LABELS[slug as EmailCategory];
  }
  return slug;
}

type DetailPageProps = {
  params: Promise<{ id: string }>;
};

export default function EmailDetailPage({ params }: DetailPageProps) {
  const { id } = use(params);
  const [email, setEmail] = useState<CapturedEmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

          {email.htmlSignedUrl ? (
            <section className="card">
              <h2>Rendered HTML</h2>
              <iframe
                src={email.htmlSignedUrl}
                title="Rendered email"
                sandbox=""
                className="email-preview-frame"
              />
            </section>
          ) : null}

          {email.metadata ? (
            <section className="card">
              <h2>Raw metadata</h2>
              <pre className="json-dump">{JSON.stringify(email.metadata, null, 2)}</pre>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
