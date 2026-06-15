import Link from "next/link";
import styles from "./home-sections.module.css";

/**
 * Site footer: a final "Browse the archive" prompt plus navigation. Links point
 * only at routes that exist (explore, brands, compare, collections, docs, help,
 * pricing, login, and the legal pages in the bottom bar).
 */
export default function SiteFooter() {
  return (
    <footer className={styles.footer} aria-label="Site footer">
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <span className={styles.footerWordmark}>Pirol</span>
          <p className={styles.footerTagline}>
            Intelligence and inspiration across thousands of newsletters.
          </p>
          <Link href="/explore" className={styles.primaryBtn}>
            Browse the archive
          </Link>
        </div>

        <nav className={styles.footerNav} aria-label="Footer">
          <div className={styles.footerCol}>
            <p className={styles.footerColTitle}>Explore</p>
            <Link href="/explore" className={styles.footerLink}>Archive</Link>
            <Link href="/brands" className={styles.footerLink}>Brands</Link>
            <Link href="/compare" className={styles.footerLink}>Comparisons</Link>
            <Link href="/collections" className={styles.footerLink}>Collections</Link>
          </div>
          <div className={styles.footerCol}>
            <p className={styles.footerColTitle}>Resources</p>
            <Link href="/docs" className={styles.footerLink}>Learn</Link>
            <Link href="/learn" className={styles.footerLink}>Tutorials</Link>
            <Link href="/help" className={styles.footerLink}>Help</Link>
            <Link href="/pricing" className={styles.footerLink}>Pricing</Link>
          </div>
          <div className={styles.footerCol}>
            <p className={styles.footerColTitle}>Account</p>
            <Link href="/login" className={styles.footerLink}>Log in</Link>
            <Link href="/login" className={styles.footerLink}>Sign up</Link>
          </div>
        </nav>
      </div>

      <div className={styles.footerBottom}>
        <span>&copy; 2026 Pirol</span>
        <nav className={styles.footerLegal} aria-label="Legal">
          <Link href="/privacy" className={styles.footerLink}>Privacy</Link>
          <Link href="/terms" className={styles.footerLink}>Terms</Link>
          <Link href="/takedown" className={styles.footerLink}>Takedown</Link>
        </nav>
      </div>
    </footer>
  );
}
