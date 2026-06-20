"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  EMAIL_CATEGORY_LABELS,
  type CompanySubscription,
  type EmailCategory
} from "@/lib/admin-types";
import { countryFlag, countryName } from "@/lib/country";

export type QualityKind =
  | "missing_market"
  | "logos"
  | "low_confidence"
  | "unattributed";

export type LowConfidenceEmail = {
  id: string;
  subject: string;
  companyName: string;
  category: string | null;
  confidence: number;
  source: string | null;
  receivedAt: string;
};

export type UnattributedEmail = {
  id: string;
  subject: string;
  sender: string;
  recipient: string;
  category: string | null;
  receivedAt: string;
};

const TITLES: Record<QualityKind, string> = {
  missing_market: "Brands missing a market",
  logos: "Logos needing review",
  low_confidence: "Low-confidence emails",
  unattributed: "Unattributed emails"
};

const SUBTITLES: Record<QualityKind, string> = {
  missing_market:
    "No resolved primary market country yet — usually fills in once the brand's HQ is looked up or enough mail lands. Open one to inspect it.",
  logos:
    "An auto-detected logo that's missing or below the confidence floor, or a manual pick the brand stopped sending. Review to lock in the right image.",
  low_confidence:
    "The classifier wasn't sure about these. Open one to confirm or correct its category.",
  unattributed:
    "These arrived at an address that matched no inbox — usually a deleted catch-all or an address we never registered. Open one to inspect the recipient and decide whether to add an inbox for it."
};

function categoryLabel(slug: string | null): string | null {
  if (!slug) return null;
  return EMAIL_CATEGORY_LABELS[slug as EmailCategory] ?? slug;
}

function logoReason(company: CompanySubscription): string {
  if (company.logoStale) return "Manual pick went stale";
  if (!company.logoUrl) return "No logo detected yet";
  if (company.logoConfidence !== null) {
    return `Low confidence · ${Math.round(company.logoConfidence * 100)}%`;
  }
  return "Needs review";
}

function getInitials(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "?";
  const letters =
    tokens.length === 1 ? tokens[0].slice(0, 2) : `${tokens[0][0]}${tokens[1][0]}`;
  return letters.toUpperCase();
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric"
});

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : DATE_FORMAT.format(parsed);
}

/**
 * Drill-down for a single "Data cleanliness" card. Brand-backed kinds
 * (missing market / logos) filter the already-loaded company list client-side;
 * the low-confidence email kind is fed a server-fetched list. Each row links to
 * where the operator actually fixes the issue.
 */
export default function QualityDetailModal({
  kind,
  companies,
  emails,
  emailsLoading,
  unattributedEmails,
  unattributedLoading,
  marketCountryOptions,
  onClose,
  onReviewLogo,
  onViewCompany,
  onSetMarket
}: {
  kind: QualityKind;
  companies: CompanySubscription[];
  emails: LowConfidenceEmail[];
  emailsLoading: boolean;
  unattributedEmails: UnattributedEmail[];
  unattributedLoading: boolean;
  marketCountryOptions: string[];
  onClose: () => void;
  onReviewLogo: (company: CompanySubscription) => void;
  onViewCompany: (company: CompanySubscription) => void;
  onSetMarket: (company: CompanySubscription, code: string) => Promise<boolean>;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const brandRows =
    kind === "missing_market"
      ? companies.filter((c) => !c.primaryMarketCountry)
      : kind === "logos"
        ? companies.filter((c) => c.needsLogoReview)
        : [];

  const count =
    kind === "low_confidence"
      ? emails.length
      : kind === "unattributed"
        ? unattributedEmails.length
        : brandRows.length;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal quality-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quality-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="quality-modal-title">
            {TITLES[kind]}{" "}
            <span className="quality-modal-count">{count}</span>
          </h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <p className="modal-subtitle">{SUBTITLES[kind]}</p>

        <div className="quality-modal-body">
          {kind === "unattributed" ? (
            unattributedLoading ? (
              <p className="muted">Loading emails…</p>
            ) : unattributedEmails.length === 0 ? (
              <p className="muted">
                Nothing here — every captured email matched an inbox.
              </p>
            ) : (
              <ul className="quality-list">
                {unattributedEmails.map((email) => (
                  <li key={email.id} className="quality-row">
                    <Link
                      href={`/admin/emails/${email.id}`}
                      className="quality-row-main"
                      onClick={onClose}
                    >
                      <span className="quality-row-title">{email.subject}</span>
                      <span className="quality-row-sub">
                        To {email.recipient} · from {email.sender}
                        {categoryLabel(email.category)
                          ? ` · ${categoryLabel(email.category)}`
                          : ""}
                      </span>
                    </Link>
                    <span className="quality-row-meta">
                      <span className="muted quality-row-date">
                        {formatDate(email.receivedAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : kind === "low_confidence" ? (
            emailsLoading ? (
              <p className="muted">Loading emails…</p>
            ) : emails.length === 0 ? (
              <p className="muted">Nothing to review — every email cleared the floor.</p>
            ) : (
              <ul className="quality-list">
                {emails.map((email) => (
                  <li key={email.id} className="quality-row">
                    <Link
                      href={`/admin/emails/${email.id}`}
                      className="quality-row-main"
                      onClick={onClose}
                    >
                      <span className="quality-row-title">{email.subject}</span>
                      <span className="quality-row-sub">
                        {email.companyName}
                        {categoryLabel(email.category)
                          ? ` · ${categoryLabel(email.category)}`
                          : ""}
                        {email.source ? ` · ${email.source}` : ""}
                      </span>
                    </Link>
                    <span className="quality-row-meta">
                      <span className="quality-confidence">
                        {Math.round(email.confidence * 100)}%
                      </span>
                      <span className="muted quality-row-date">
                        {formatDate(email.receivedAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : brandRows.length === 0 ? (
            <p className="muted">Nothing to fix here — all clear.</p>
          ) : (
            <ul className="quality-list">
              {brandRows.map((company) => (
                <li key={company.id} className="quality-row">
                  <div className="quality-row-main">
                    <span className="quality-row-title">
                      {kind === "logos" ? (
                        <span className="quality-logo-thumb" aria-hidden="true">
                          {company.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={company.logoUrl} alt="" />
                          ) : (
                            getInitials(company.name)
                          )}
                        </span>
                      ) : null}
                      {company.name}
                    </span>
                    <span className="quality-row-sub">
                      {company.domain}
                      {kind === "logos"
                        ? ` · ${logoReason(company)}`
                        : company.markets.length > 0
                          ? ` · ${company.markets.join(", ")}`
                          : " · no category tags"}
                    </span>
                  </div>
                  <span className="quality-row-meta">
                    {kind === "logos" ? (
                      <button
                        type="button"
                        className="quality-row-action"
                        onClick={() => onReviewLogo(company)}
                      >
                        Review logo
                      </button>
                    ) : (
                      <>
                        <select
                          className="quality-row-market"
                          value=""
                          disabled={savingId === company.id}
                          aria-label={`Set primary market for ${company.name}`}
                          title="Pin a primary market country for this brand"
                          onChange={async (event) => {
                            const code = event.target.value;
                            if (!code) return;
                            setSavingId(company.id);
                            await onSetMarket(company, code);
                            setSavingId(null);
                          }}
                        >
                          <option value="">
                            {savingId === company.id ? "Saving…" : "Set market…"}
                          </option>
                          {marketCountryOptions.map((code) => (
                            <option key={code} value={code}>
                              {countryFlag(code)} {countryName(code)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="quality-row-action"
                          onClick={() => onViewCompany(company)}
                        >
                          View brand
                        </button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
