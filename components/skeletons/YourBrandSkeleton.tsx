import styles from "@/components/your-brand/your-brand.module.css";
import bars from "./detail-skeleton.module.css";

/**
 * Instant loading state for `/your-brand`. Heading and section shells
 * reuse the page's own CSS module classes so the real content streams in
 * exactly on top; the insight-card grid is data-dependent, so the two
 * card placeholders are an honest approximation, not a pixel match.
 */
export default function YourBrandSkeleton() {
  return (
    <main className={styles.main} aria-hidden>
      <header className={styles.heading}>
        <div>
          <div className={bars.cmpTitleBar} />
          <div className={bars.cmpSubBar} />
          <div className={styles.brandLine}>
            <div className={bars.stripPill} style={{ width: "9rem" }} />
            <div className={bars.stripPill} style={{ width: "13rem" }} />
          </div>
        </div>
      </header>

      <section className={styles.section}>
        <div className={bars.eyebrowBar} />
        <div className={bars.sectionTitleBar} />
        <div className={bars.sectionSubBar} />
        <div className={styles.sectionBody}>
          <div className={styles.cardGrid}>
            {[0, 1].map((i) => (
              <div key={i} className={styles.card}>
                <div className={bars.stripPill} style={{ width: "7rem" }} />
                <div className={bars.sectionTitleBar} />
                <div className={bars.sectionSubBar} />
                <div className={bars.sectionSubBar} style={{ width: "60%" }} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={bars.eyebrowBar} />
        <div className={bars.sectionTitleBar} />
        <div className={bars.sectionSubBar} />
        <div className={styles.sectionBody}>
          <div className={bars.stripPill} style={{ width: "16rem" }} />
        </div>
      </section>
    </main>
  );
}
