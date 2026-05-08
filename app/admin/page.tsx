"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AdminOverview, EmailCategory } from "@/lib/admin-types";

const ALL_CATEGORIES: EmailCategory[] = [
  "sale",
  "product_launch",
  "event",
  "content",
  "loyalty",
  "transactional",
  "seasonal",
  "partnership",
  "company_news",
  "other"
];

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

function categoryLabel(slug: string): string {
  if ((ALL_CATEGORIES as string[]).includes(slug)) {
    return CATEGORY_LABELS[slug as EmailCategory];
  }
  return slug;
}

const defaultOverview: AdminOverview = {
  companies: [],
  emails: [],
  categories: ALL_CATEGORIES,
  storageNotes: "",
  pagination: { nextCursor: null, pageSize: 50 }
};

function asOverview(value: unknown): AdminOverview {
  if (!value || typeof value !== "object") {
    return defaultOverview;
  }
  const candidate = value as Partial<AdminOverview>;
  const paginationCandidate =
    typeof candidate.pagination === "object" && candidate.pagination !== null
      ? candidate.pagination
      : null;
  return {
    companies: Array.isArray(candidate.companies) ? candidate.companies : [],
    emails: Array.isArray(candidate.emails) ? candidate.emails : [],
    categories: Array.isArray(candidate.categories) ? candidate.categories : defaultOverview.categories,
    storageNotes: typeof candidate.storageNotes === "string" ? candidate.storageNotes : "",
    pagination: {
      nextCursor:
        paginationCandidate && typeof paginationCandidate.nextCursor === "string"
          ? paginationCandidate.nextCursor
          : null,
      pageSize:
        paginationCandidate && typeof paginationCandidate.pageSize === "number"
          ? paginationCandidate.pageSize
          : defaultOverview.pagination.pageSize
    }
  };
}

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

const NEW_MARKET_OPTION = "__new__";

export default function AdminHomePage() {
  const [overview, setOverview] = useState<AdminOverview>(defaultOverview);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [market, setMarket] = useState("");
  const [newMarket, setNewMarket] = useState("");
  const [isAddingMarket, setIsAddingMarket] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  async function copySubscriptionEmail(email: string) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(email);
      }
      setCopiedEmail(email);
      window.setTimeout(() => {
        setCopiedEmail((current) => (current === email ? null : current));
      }, 1500);
    } catch {
      // ignore clipboard failures silently
    }
  }

  async function loadOverview() {
    try {
      setLoading(true);
      setLoadError("");
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      const data = (await response.json()) as unknown;

      if (!response.ok) {
        const body = data as { error?: string };
        setOverview(defaultOverview);
        setLoadError(body.error ?? "Failed to load admin overview.");
        return;
      }

      setOverview(asOverview(data));
    } catch {
      setOverview(defaultOverview);
      setLoadError("Failed to load admin overview.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  const stats = useMemo(
    () => ({
      companies: overview.companies.length,
      emails: overview.emails.length,
      sales: overview.emails.filter((mail) => mail.category === "sale").length,
      launches: overview.emails.filter((mail) => mail.category === "product_launch").length
    }),
    [overview]
  );

  const existingMarkets = useMemo(() => {
    const set = new Set<string>();
    for (const company of overview.companies) {
      const value = company.market?.trim();
      if (value) {
        set.add(value);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [overview.companies]);

  const sortedCompanies = useMemo(() => {
    const copy = [...overview.companies];
    copy.sort((a, b) => {
      const aHas = a.lastEmailAt ? 1 : 0;
      const bHas = b.lastEmailAt ? 1 : 0;
      if (aHas !== bHas) {
        return bHas - aHas;
      }
      if (a.lastEmailAt && b.lastEmailAt) {
        return new Date(b.lastEmailAt).getTime() - new Date(a.lastEmailAt).getTime();
      }
      return new Date(b.subscribedAt).getTime() - new Date(a.subscribedAt).getTime();
    });
    return copy;
  }, [overview.companies]);

  const filteredCompanies = useMemo(() => {
    const query = companySearch.trim().toLowerCase();
    if (!query) {
      return sortedCompanies;
    }
    return sortedCompanies.filter((company) => {
      const haystack = [
        company.name,
        company.domain,
        company.market ?? "",
        company.subscriptionEmail
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [sortedCompanies, companySearch]);

  async function onCreateCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const resolvedMarket = isAddingMarket ? newMarket.trim() : market.trim();

    const response = await fetch("/api/admin/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, domain, market: resolvedMarket || null })
    });

    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Could not create company subscription.");
      return;
    }

    setName("");
    setDomain("");
    setMarket("");
    setNewMarket("");
    setIsAddingMarket(false);
    await loadOverview();
  }

  return (
    <main className="admin-page">
      <section className="header admin-header">
        <div>
          <h1>Pirol Admin Center</h1>
          <p>Track subscribed competitors, ingest newsletters from Resend webhooks, and classify every email.</p>
          {loadError ? <p className="error">{loadError}</p> : null}
        </div>
        <form action="/auth/signout" method="post">
          <button type="submit" className="sign-out">
            Sign out
          </button>
        </form>
      </section>

      <section className="stats-grid">
        <article className="card">
          <h2>Companies</h2>
          <p>{stats.companies}</p>
        </article>
        <article className="card">
          <h2>Captured Emails</h2>
          <p>{stats.emails}</p>
        </article>
        <article className="card">
          <h2>Sales / Discounts</h2>
          <p>{stats.sales}</p>
        </article>
        <article className="card">
          <h2>Product Launches</h2>
          <p>{stats.launches}</p>
        </article>
      </section>

      <section className="card">
        <h2>Create Company Subscription Email</h2>
        <p>
          Generates a unique sender like <code>company-yyyymmdd@pirol.app</code> for each newsletter signup.
        </p>
        <form className="inline-form with-market" onSubmit={onCreateCompany}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Company Name"
            aria-label="Company Name"
            required
          />
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="company.com"
            aria-label="Company Domain"
            required
          />
          {isAddingMarket ? (
            <div className="market-new-field">
              <input
                value={newMarket}
                onChange={(e) => setNewMarket(e.target.value)}
                placeholder="New market (e.g. fashion, museum)"
                aria-label="New market"
                autoFocus
              />
              <button
                type="button"
                className="market-cancel"
                onClick={() => {
                  setIsAddingMarket(false);
                  setNewMarket("");
                }}
                aria-label="Cancel new market"
              >
                Cancel
              </button>
            </div>
          ) : (
            <select
              value={market}
              onChange={(e) => {
                const value = e.target.value;
                if (value === NEW_MARKET_OPTION) {
                  setIsAddingMarket(true);
                  setMarket("");
                } else {
                  setMarket(value);
                }
              }}
              aria-label="Market"
            >
              <option value="">Select market</option>
              {existingMarkets.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={NEW_MARKET_OPTION}>+ Add new market…</option>
            </select>
          )}
          <button type="submit">Create</button>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="card">
        <h2>Subscribed Companies</h2>
        <div className="section-toolbar">
          <input
            className="search-input"
            type="search"
            value={companySearch}
            onChange={(e) => setCompanySearch(e.target.value)}
            placeholder="Search by name, domain, market, or email"
            aria-label="Search companies"
          />
          <span className="muted">
            {filteredCompanies.length} of {sortedCompanies.length} shown
          </span>
        </div>
        {loading ? (
          <p>Loading...</p>
        ) : sortedCompanies.length === 0 ? (
          <p>No companies subscribed yet.</p>
        ) : filteredCompanies.length === 0 ? (
          <p>No companies match your search.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Market</th>
                <th>Domain</th>
                <th>Subscription Email</th>
                <th>Subscribed Since</th>
                <th className="numeric">Emails</th>
                <th>Last Email</th>
              </tr>
            </thead>
            <tbody>
              {filteredCompanies.map((company) => (
                <tr key={company.id}>
                  <td>{company.name}</td>
                  <td>{company.market ? company.market : <span className="dim">-</span>}</td>
                  <td>{company.domain}</td>
                  <td>
                    <span className="email-cell">
                      <code>{company.subscriptionEmail}</code>
                      <button
                        type="button"
                        className="copy-button"
                        onClick={() => {
                          void copySubscriptionEmail(company.subscriptionEmail);
                        }}
                        aria-label={`Copy ${company.subscriptionEmail}`}
                        title={
                          copiedEmail === company.subscriptionEmail
                            ? "Copied!"
                            : "Copy email"
                        }
                      >
                        {copiedEmail === company.subscriptionEmail ? (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>
                    </span>
                  </td>
                  <td>{formatDateTime(company.subscribedAt)}</td>
                  <td className="numeric">{company.emailCount}</td>
                  <td>
                    {company.lastEmailAt ? (
                      formatDateTime(company.lastEmailAt)
                    ) : (
                      <span className="dim">never</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Recent Emails + Classification</h2>
        <p>Classification source can be rule-based now and LLM-provided when available in webhook payload.</p>
        {overview.emails.length === 0 ? (
          <p>
            No emails ingested yet. Post to <code>/api/webhooks/resend</code> to test.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Subject</th>
                <th>Category</th>
                <th>Subcategory</th>
                <th>Source</th>
                <th className="numeric">Images</th>
                <th>Sent At</th>
              </tr>
            </thead>
            <tbody>
              {overview.emails.map((email) => (
                <tr key={email.id}>
                  <td>{email.companyName}</td>
                  <td>{email.subject}</td>
                  <td>{categoryLabel(email.category)}</td>
                  <td>
                    {email.subcategory ? email.subcategory : <span className="dim">-</span>}
                  </td>
                  <td>{email.classificationSource}</td>
                  <td className="numeric">{email.imageUrls.length}</td>
                  <td>{formatDateTime(email.sentAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Storage Strategy</h2>
        <p>{overview.storageNotes}</p>
      </section>
    </main>
  );
}
