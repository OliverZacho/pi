"use client";

import { useState } from "react";
import styles from "./HelpPane.module.css";

const MAX_MESSAGE = 2000;

/**
 * Inline "Share feedback" form shown inside the HelpPane (the same slot the
 * support chat uses). Posts to `/api/feature-requests` and swaps to a
 * thank-you state on success. Replaces the old FeatureRequestModal popup.
 */
export default function SupportFeedback() {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    const trimmed = message.trim();
    if (!trimmed || submitting) {
      if (!trimmed) setError("Please describe your idea first.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/feature-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className={styles.feedbackBody}>
        <div className={styles.feedbackSuccess} role="status">
          <span className={styles.feedbackSuccessTitle}>Thanks for the idea!</span>
          <span className={styles.feedbackSuccessText}>
            We read every suggestion and weigh it into the roadmap.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.feedbackBody}>
      <p className={styles.feedbackLead}>
        Got an idea for Pirol? Tell us what would make it more useful.
      </p>
      <textarea
        className={styles.feedbackText}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        maxLength={MAX_MESSAGE}
        rows={5}
        placeholder="e.g. Export a comparison to PDF, or alert me when a brand changes cadence."
      />
      {error ? <p className={styles.feedbackError}>{error}</p> : null}
      <button
        type="button"
        className={styles.feedbackSubmit}
        onClick={() => void submit()}
        disabled={submitting || message.trim().length === 0}
      >
        {submitting ? "Sending…" : "Send feedback"}
      </button>
    </div>
  );
}
