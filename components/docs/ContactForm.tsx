"use client";

import { useState } from "react";
import styles from "./docs.module.css";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "success" };

const TOPICS = [
  "General question",
  "Billing & subscription",
  "Technical issue / bug",
  "Feature request",
  "Sales & pricing",
  "Something else"
];

export default function ContactForm() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "submitting" });

    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      topic: String(data.get("topic") ?? "").trim(),
      message: String(data.get("message") ?? "").trim()
    };

    if (!payload.name || !payload.email || !payload.message) {
      setStatus({ kind: "error", message: "Please fill in your name, email, and message." });
      return;
    }

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Something went wrong. Please try again.");
      }

      form.reset();
      setStatus({ kind: "success" });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Something went wrong."
      });
    }
  }

  if (status.kind === "success") {
    return (
      <div className={styles.formCard}>
        <div className={styles.formSuccess}>
          <span className={styles.successMark}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="m5 13 4 4L19 7"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h3>Thanks — we got your message</h3>
          <p>
            A member of the team will get back to you by email, usually within one
            business day.
          </p>
          <button
            type="button"
            className={styles.submitBtn}
            onClick={() => setStatus({ kind: "idle" })}
          >
            Send another message
          </button>
        </div>
      </div>
    );
  }

  const submitting = status.kind === "submitting";

  return (
    <div className={styles.formCard}>
      <form className={styles.formGrid} onSubmit={handleSubmit} noValidate>
        <div className={styles.formRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="name">
              Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              className={styles.input}
              placeholder="Your name"
              autoComplete="name"
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className={styles.input}
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="topic">
            What can we help with?
          </label>
          <select id="topic" name="topic" className={styles.select} defaultValue={TOPICS[0]}>
            {TOPICS.map((topic) => (
              <option key={topic} value={topic}>
                {topic}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="message">
            Message
          </label>
          <textarea
            id="message"
            name="message"
            className={styles.textarea}
            placeholder="Tell us what's going on…"
            required
          />
        </div>

        <div className={styles.submitRow}>
          <button type="submit" className={styles.submitBtn} disabled={submitting}>
            {submitting ? "Sending…" : "Send message"}
          </button>
          {status.kind === "error" ? (
            <span className={`${styles.formStatus} ${styles.formStatusError}`}>
              {status.message}
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
