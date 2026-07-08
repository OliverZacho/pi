import Link from "next/link";
import styles from "./home-sections.module.css";

/**
 * Pricing teaser built to convert: it frames the upgrade as Free (look) →
 * Solo (act), shows the real feature delta that unlocks, anchors annual as the
 * better deal, and removes risk (no card to start, 7-day refund). Numbers and
 * feature lists mirror the pricing page (Pricing.tsx).
 */
export default function PricingTeaser() {
  return (
    <section className={styles.pricingSection} aria-labelledby="pricing-teaser-title">
      <div className={styles.sectionHead}>
        <p className={styles.eyebrow}>Pricing</p>
        <h2 id="pricing-teaser-title" className={styles.sectionTitle}>
          Free shows you the archive. Solo hands you the playbook.
        </h2>
        <p className={styles.sectionLede}>
          Start free, no card required. When you&rsquo;re ready to act on what
          you find, one upgrade unlocks every email, every brand, and every
          dashboard.
        </p>
      </div>

      <div className={styles.planRow}>
        {/* Free */}
        <div className={styles.plan}>
          <div className={styles.planTop}>
            <span className={styles.planName}>Free</span>
            <span className={styles.planBlurb}>For getting a feel for the archive.</span>
          </div>
          <div className={styles.planPrice}>
            <span className={styles.planAmount}>€0</span>
            <span className={styles.planPer}>free forever</span>
          </div>
          <ul className={styles.planFeatures}>
            <li>Preview the entire archive</li>
            <li>Search &amp; filter across every brand</li>
            <li>Save up to 25 emails</li>
            <li>Email breakdowns: ESP, category &amp; design</li>
          </ul>
          <Link href="/login" className={styles.planCtaGhost}>
            Create free account
          </Link>
        </div>

        {/* Solo — featured */}
        <div className={`${styles.plan} ${styles.planFeatured}`}>
          <span className={styles.planTag}>Most popular</span>
          <div className={styles.planTop}>
            <span className={styles.planName}>Solo</span>
            <span className={styles.planBlurb}>For the marketer studying the competition.</span>
          </div>
          <div className={styles.planPrice}>
            <span className={styles.planAmount}>€30</span>
            <span className={styles.planPer}>/ month</span>
            <span className={styles.planAnnual}>or €300/yr, 2 months free</span>
          </div>
          <p className={styles.planEverything}>Everything in Free, plus:</p>
          <ul className={`${styles.planFeatures} ${styles.planFeaturesUnlock}`}>
            <li>Full archive — sources &amp; links unlocked</li>
            <li>Unlimited saves &amp; collections</li>
            <li>Compare brands side by side</li>
            <li>Stats &amp; analytics dashboards</li>
            <li>Follow brands &amp; catch every new send</li>
          </ul>
          <Link href="/login" className={styles.planCta}>
            Get Solo
          </Link>
        </div>
      </div>

      <p className={styles.teamLine}>
        Working as a team? <strong>Team</strong>{" "}adds up to 6 seats, shared
        collections &amp; priority support for €90/mo.{" "}
        <Link href="/pricing" className={styles.inlineLink}>
          Compare all plans →
        </Link>
      </p>

      <ul className={styles.reassure}>
        <li>No card required to start</li>
        <li>7-day refund, no questions asked</li>
        <li>Cancel anytime</li>
      </ul>
    </section>
  );
}
