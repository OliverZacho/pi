import Link from "next/link";
import styles from "./home-sections.module.css";

/**
 * Site footer: a final "Browse the archive" prompt plus navigation. Product
 * links point at the public surfaces — the archive itself plus the
 * /features/* explainer pages — never at auth-gated app routes.
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
          {/* Points at /brands, not /explore: the brand directory is the
              public, crawlable surface — /explore is login-walled and
              disallowed in robots.txt, so linking it here wastes both the
              click and the link equity. */}
          <Link href="/brands" className={styles.primaryBtn}>
            Browse the brands
          </Link>
        </div>

        <nav className={styles.footerNav} aria-label="Footer">
          <div className={styles.footerCol}>
            <p className={styles.footerColTitle}>Product</p>
            <Link href="/brands" className={styles.footerLink}>Brand directory</Link>
            <Link href="/features/brands" className={styles.footerLink}>Brand insights</Link>
            <Link href="/features/explore" className={styles.footerLink}>Archive</Link>
            <Link href="/features/collections" className={styles.footerLink}>Collections</Link>
            <Link href="/features/comparisons" className={styles.footerLink}>Comparisons</Link>
            <Link href="/features/following" className={styles.footerLink}>Following</Link>
          </div>
          <div className={styles.footerCol}>
            <p className={styles.footerColTitle}>Resources</p>
            <Link href="/learn" className={styles.footerLink}>Learn</Link>
            <Link href="/tutorials" className={styles.footerLink}>Tutorials</Link>
            <Link href="/help" className={styles.footerLink}>Help</Link>
            <Link href="/pricing" className={styles.footerLink}>Pricing</Link>
          </div>
          <div className={styles.footerCol}>
            <p className={styles.footerColTitle}>Account</p>
            <Link href="/login" className={styles.footerLink}>Log in</Link>
            <Link href="/signup" className={styles.footerLink}>Sign up</Link>
          </div>
        </nav>
      </div>

      <div className={styles.footerBottom}>
        <span>&copy; 2026 Pirol</span>
        <nav className={styles.footerLegal} aria-label="Legal">
          {/* Required Logo.dev free-plan attribution; must pass referrer
              data, so no rel="noreferrer" here. */}
          <a
            href="https://logo.dev"
            className={styles.footerLink}
            target="_blank"
            rel="noopener"
          >
            Logos provided by Logo.dev
          </a>
          <Link href="/privacy" className={styles.footerLink}>Privacy</Link>
          <Link href="/terms" className={styles.footerLink}>Terms</Link>
          <Link href="/takedown" className={styles.footerLink}>Takedown</Link>
        </nav>
      </div>
    </footer>
  );
}
