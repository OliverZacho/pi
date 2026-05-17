"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { HERO_EMAIL, type HeroEmail } from "@/lib/marketing/hero-data";
import styles from "./splitreveal.module.css";

function formatRelative(iso: string): string {
  const sent = new Date(iso);
  const now = new Date();
  const days = Math.max(0, Math.floor((now.getTime() - sent.getTime()) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return sent.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

type Props = { email?: HeroEmail };

// Most marketing emails are designed around a 600–680px outer table.
// We scale the iframe down to fit the (narrower) hero column so the
// full design stays visible top-to-bottom instead of getting clipped
// on the right edge.
const NOMINAL_EMAIL_WIDTH = 640;

/**
 * Renders the inbox-style "envelope" (sender, subject, preheader) at the top
 * and embeds the **real** captured email HTML in a sandboxed iframe below it.
 *
 * The HTML is snapshotted by `scripts/snapshot-hero-emails.ts` into
 * `public/hero-emails/{id}.html` so the landing page can serve it statically
 * without any DB calls at request time.
 *
 * The iframe is force-rendered at NOMINAL_EMAIL_WIDTH and CSS-scaled down to
 * fit the available column. That way the email looks the way the brand
 * designed it (cards, hero image, type) rather than reflowing into a
 * narrow phone-size layout.
 */
export default function EmailPreview({ email = HERO_EMAIL }: Props) {
  const sender = `newsletter@${email.brand.domain}`;
  const relative = formatRelative(email.sentAt);
  const renderSrc = `/hero-emails/${email.id}.html`;

  const frameRef = useRef<HTMLDivElement | null>(null);
  // scale === null means we haven't measured yet → hide the iframe to avoid
  // a single frame of 640px overflow before the layout effect runs.
  const [scale, setScale] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node) return;

    const update = () => {
      const width = node.clientWidth;
      if (width <= 0) return;
      // Never scale up — only shrink when the column is narrower than the
      // email's nominal width.
      setScale(Math.min(1, width / NOMINAL_EMAIL_WIDTH));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  return (
    <article
      className={styles.emailPreview}
      aria-label={`Newsletter from ${email.brand.name}`}
    >
      <header className={styles.emailMeta}>
        <div className={styles.senderAvatar} aria-hidden="true">
          {email.brand.name.charAt(0)}
        </div>
        <div className={styles.senderInfo}>
          <div className={styles.senderRow}>
            <span className={styles.senderName}>{email.brand.name}</span>
            <span className={styles.senderEmail}>&lt;{sender}&gt;</span>
            <span className={styles.senderDot}>·</span>
            <span className={styles.senderTime}>{relative}</span>
          </div>
          <h2 className={styles.emailSubject}>{email.subject}</h2>
          <p className={styles.emailPreheader}>{email.preheader}</p>
        </div>
      </header>

      <div ref={frameRef} className={styles.emailRenderFrame}>
        <iframe
          src={renderSrc}
          title={`${email.brand.name} — ${email.subject}`}
          // Sandboxed: no scripts, no top-level navigation. The captured HTML
          // is from trusted captured_emails rows we vendor at build time, but
          // we still belt-and-braces this since marketing emails contain
          // arbitrary third-party markup.
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          loading="eager"
          className={styles.emailRenderIframe}
          style={{
            width: `${NOMINAL_EMAIL_WIDTH}px`,
            // Render the iframe tall enough that any vertical clipping happens
            // outside its document — the bottom mask on the hero card fades
            // it out naturally.
            height: `${Math.round(100 / (scale ?? 1))}%`,
            transform: `scale(${scale ?? 1})`,
            transformOrigin: "top left",
            // Hide until we've measured to avoid a single frame of 640px
            // overflow before the layout effect runs.
            opacity: scale === null ? 0 : 1
          }}
        />
      </div>
    </article>
  );
}
