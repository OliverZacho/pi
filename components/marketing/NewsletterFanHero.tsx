import Link from "next/link";
import NewsletterFan from "./NewsletterFan";
import styles from "./newsletter-hero.module.css";

/**
 * Front-page hero: marketing copy + CTAs on the left, the animated 3D fan of
 * real captured newsletters on the right (the same component the login page
 * renders statically).
 */
export default function NewsletterFanHero() {
  return (
    <section className={styles.hero} aria-label="Brand intelligence preview">
      <div className={styles.heroCopy}>
        <h1 className={styles.headline}>
          Intelligence and inspiration across thousands of newsletters
        </h1>
        <p className={styles.subhead}>
          Every email from the brands you track — captured, analysed, and
          searchable in one place.
        </p>
        <div className={styles.ctaRow}>
          <Link href="/login" className={styles.primaryBtn}>
            Sign up
          </Link>
          <Link href="/login" className={styles.secondaryBtn}>
            Log in
            <span className={styles.secondaryArrow} aria-hidden>
              →
            </span>
          </Link>
        </div>
      </div>

      <div className={styles.visual} aria-hidden="true">
        <NewsletterFan animate interactive />
      </div>
    </section>
  );
}
