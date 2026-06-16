"use client";

import { useState, type FormEvent } from "react";
import styles from "@/components/brand/BrandRequest.module.css";

type FeatureRequestFormProps = {
  /** Called after a successful submission (e.g. to auto-close a modal). */
  onSuccess?: () => void;
};

const MAX_MESSAGE = 2000;

/**
 * The "Request a feature" form, opened from the account menu. Collects a
 * free-form message, POSTs to `/api/feature-requests`, and shows a thank-you
 * confirmation once submitted. Reuses the Brand-request CSS module for the
 * shared field/button styling.
 */
export default function FeatureRequestForm({
  onSuccess
}: FeatureRequestFormProps) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmed = message.trim();
    if (!trimmed) {
      setError("Please describe the feature you'd like.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/feature-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed })
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
          We read every suggestion and weigh it into the roadmap.
        </span>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label className={styles.field}>
        <span className={styles.label}>What would you like to see?</span>
        <textarea
          className={`${styles.input} ${styles.textarea}`}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="e.g. Export a comparison to PDF, or alert me when a brand changes cadence."
          maxLength={MAX_MESSAGE}
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
