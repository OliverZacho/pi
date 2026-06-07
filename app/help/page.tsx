import Link from "next/link";
import DocsHeader from "@/components/docs/DocsHeader";
import ContactForm from "@/components/docs/ContactForm";
import { SUPPORT_EMAIL, SALES_EMAIL } from "@/lib/docs/support";
import styles from "@/components/docs/docs.module.css";

export const metadata = {
  title: "Help & Contact — Pirol",
  description:
    "Get in touch with the Pirol team. Send us a message or email us directly — we usually reply within one business day."
};

export default function HelpPage() {
  return (
    <div className={styles.shell}>
      <DocsHeader />
      <div>
        <div className={styles.simpleLayout} style={{ paddingBottom: 0 }}>
          <header className={styles.pageHeader}>
            <h1 className={styles.pageTitle}>How can we help?</h1>
            <p className={styles.pageLead}>
              Send us a message and we&apos;ll get back to you by email — usually
              within one business day. Prefer email? Reach us directly using the
              addresses on the right.
            </p>
          </header>
        </div>

        <div className={styles.helpLayout}>
          <ContactForm />

          <div className={styles.helpAside}>
            <div className={styles.contactCard}>
              <h3>Email us directly</h3>
              <p>For anything you&apos;d rather send over email.</p>
              <a className={styles.contactLink} href={`mailto:${SUPPORT_EMAIL}`}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
                  <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {SUPPORT_EMAIL}
              </a>
            </div>

            <div className={styles.contactCard}>
              <h3>Talk to sales</h3>
              <p>Pricing, plans, and demos for larger teams.</p>
              <a className={styles.contactLink} href={`mailto:${SALES_EMAIL}`}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
                  <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {SALES_EMAIL}
              </a>
            </div>

            <div className={styles.contactCard}>
              <h3>Before you write in</h3>
              <ul className={styles.contactList}>
                <li className={styles.contactListItem}>
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M8 10h8M8 14h5M21 12a9 9 0 1 1-3.5-7.1L21 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>
                    Browse the <Link href="/docs">documentation</Link> for guides on ESPs,
                    deliverability, and strategy.
                  </span>
                </li>
                <li className={styles.contactListItem}>
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M8 5v14l11-7z" fill="currentColor" />
                  </svg>
                  <span>
                    Watch a <a href="/learn">video tutorial</a> for step-by-step
                    walkthroughs of every feature.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
