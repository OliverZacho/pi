"use client";

import { useState, type FormEvent } from "react";
import styles from "./BrandRequest.module.css";

type BrandRequestFormProps = {
  /** Prefills the company name with whatever the visitor just searched for. */
  defaultCompanyName?: string;
  /** Called after a successful submission (e.g. to auto-close a modal). */
  onSuccess?: () => void;
};

const MAX_FIELD = 200;

/**
 * The "Request a brand" form. Shared between the inline Brands-page empty
 * state and the Explore modal. Collects a company name + website, POSTs to
 * the public `/api/brand-requests` endpoint, and shows a "check back soon"
 * confirmation once submitted.
 */
export default function BrandRequestForm({
  defaultCompanyName = "",
  onSuccess
}: BrandRequestFormProps) {
  const [companyName, setCompanyName] = useState(defaultCompanyName);
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmedName = companyName.trim();
    const trimmedSite = website.trim();
    if (!trimmedName || !trimmedSite) {
      setError("Company name and website are both required.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/brand-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: trimmedName, website: trimmedSite })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      setDone(true);
      onSuccess?.();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className={styles.success} role="status">
        <span className={styles.successTitle}>Request received — thank you!</span>
        <span className={styles.successText}>
          Brands are usually added within 24 hours, so check back soon.
        </span>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label className={styles.field}>
        <span className={styles.label}>Company name</span>
        <input
          className={styles.input}
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
          placeholder="e.g. Ganni"
          maxLength={MAX_FIELD}
          autoComplete="organization"
          required
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Website link</span>
        <input
          className={styles.input}
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          placeholder="e.g. ganni.com"
          maxLength={MAX_FIELD}
          autoComplete="url"
          required
        />
      </label>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <button className={styles.submit} type="submit" disabled={submitting}>
        {submitting ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}
