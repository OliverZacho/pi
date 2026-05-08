"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AdminOverview } from "@/lib/admin-types";

const defaultOverview: AdminOverview = {
  companies: [],
  emails: [],
  categories: ["new_launch", "sale", "newsletter", "product_update", "event", "other"],
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

export default function AdminHomePage() {
  const [overview, setOverview] = useState<AdminOverview>(defaultOverview);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");

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
      launches: overview.emails.filter((mail) => mail.category === "new_launch").length
    }),
    [overview]
  );

  async function onCreateCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const response = await fetch("/api/admin/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, domain })
    });

    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Could not create company subscription.");
      return;
    }

    setName("");
    setDomain("");
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
          <h2>Sales Emails</h2>
          <p>{stats.sales}</p>
        </article>
        <article className="card">
          <h2>Launch Emails</h2>
          <p>{stats.launches}</p>
        </article>
      </section>

      <section className="card">
        <h2>Create Company Subscription Email</h2>
        <p>
          Generates a unique sender like <code>company-yyyymmdd@pirol.app</code> for each newsletter signup.
        </p>
        <form className="inline-form" onSubmit={onCreateCompany}>
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
          <button type="submit">Create</button>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="card">
        <h2>Subscribed Companies</h2>
        {loading ? (
          <p>Loading...</p>
        ) : overview.companies.length === 0 ? (
          <p>No companies subscribed yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Domain</th>
                <th>Subscription Email</th>
                <th>Subscribed Since</th>
              </tr>
            </thead>
            <tbody>
              {overview.companies.map((company) => (
                <tr key={company.id}>
                  <td>{company.name}</td>
                  <td>{company.domain}</td>
                  <td>
                    <code>{company.subscriptionEmail}</code>
                  </td>
                  <td>{new Date(company.subscribedAt).toLocaleString()}</td>
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
                <th>Source</th>
                <th>Images</th>
                <th>Sent At</th>
              </tr>
            </thead>
            <tbody>
              {overview.emails.map((email) => (
                <tr key={email.id}>
                  <td>{email.companyName}</td>
                  <td>{email.subject}</td>
                  <td>
                    <code>{email.category}</code>
                  </td>
                  <td>{email.classificationSource}</td>
                  <td>{email.imageUrls.length}</td>
                  <td>{new Date(email.sentAt).toLocaleString()}</td>
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
