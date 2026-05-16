import AnalysisPanel from "./AnalysisPanel";
import EmailPreview from "./EmailPreview";
import styles from "./splitreveal.module.css";

export default function SplitRevealHero() {
  return (
    <section className={styles.splitWrap} aria-labelledby="split-reveal-title">
      <div className={styles.captionRow}>
        <span className={styles.captionTag}>Live capture · 12 sec ago</span>
        <h2 id="split-reveal-title" className={styles.captionTitle}>
          One email in. One brand decoded.
        </h2>
      </div>
      <div className={styles.split}>
        <div className={styles.splitLeft}>
          <EmailPreview />
        </div>
        <div className={styles.splitRight}>
          <AnalysisPanel />
        </div>
      </div>
    </section>
  );
}
