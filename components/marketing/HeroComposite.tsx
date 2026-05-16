import Link from "next/link";
import AnalysisPanel from "./AnalysisPanel";
import EmailPreview from "./EmailPreview";
import styles from "./herocomposite.module.css";

export default function HeroComposite() {
  return (
    <section className={styles.wrap} aria-labelledby="hero-title">
      <div className={styles.grid}>
        <div className={styles.colLeft}>
          <div className={styles.scrollFrame}>
            <EmailPreview />
          </div>
        </div>

        <div className={styles.colCenter}>
          {/* Two synchronized pulse dots that sit on the inner edge of
              each side panel — a subtle "live link" between them. */}
          <span
            className={`${styles.linkDot} ${styles.linkDotLeft}`}
            aria-hidden="true"
          />
          <span
            className={`${styles.linkDot} ${styles.linkDotRight}`}
            aria-hidden="true"
          />

          <div className={styles.centerInner}>
            <p className={styles.eyebrow}>Pirol</p>

            <h1 id="hero-title" className={styles.headline}>
              Your space
              <br />
              for brand
              <br />
              intelligence
            </h1>

            <p className={styles.subhead}>
              Every email, every drop, every logo — from the brands you’re
              tracking, connected and searchable in one place.
            </p>

            <div className={styles.ctaRow}>
              <Link href="#" className={styles.primaryBtn}>
                Sign up
              </Link>
              <Link href="#" className={styles.secondaryBtn}>
                Get a demo
              </Link>
            </div>
          </div>
        </div>

        <div className={styles.colRight}>
          <AnalysisPanel />
        </div>
      </div>
    </section>
  );
}
