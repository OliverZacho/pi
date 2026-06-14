import styles from "./home-sections.module.css";

/**
 * "Why Pirol" — three outcome blocks framed around what a marketer *learns*,
 * not a flat feature list. Each block carries a small CSS-built visual so the
 * section reads as product, not prose.
 */
export default function OutcomeBlocks() {
  return (
    <section className={styles.section} aria-labelledby="outcomes-title">
      <div className={styles.sectionHead}>
        <p className={styles.eyebrow}>Why Pirol</p>
        <h2 id="outcomes-title" className={styles.sectionTitle}>
          Stop guessing what works in email.
        </h2>
        <p className={styles.sectionLede}>
          Thousands of real marketing emails, captured and broken down — so you
          can see what the best brands send, learn why it works, and keep the
          parts worth stealing.
        </p>
      </div>

      <div className={styles.cardGrid}>
        {/* See what they send */}
        <article className={styles.card}>
          <div className={styles.cardVisual}>
            <div className={styles.miniEmail}>
              <div className={styles.miniEmailBar}>
                <span className={styles.miniDot} />
                <span className={styles.miniDot} />
                <span className={styles.miniDot} />
              </div>
              <div className={styles.miniEmailBody} />
              <div className={styles.miniTags}>
                <span className={styles.miniTag}>Klaviyo</span>
                <span className={styles.miniTag}>Welcome series</span>
              </div>
            </div>
          </div>
          <h3 className={styles.cardTitle}>See what the best brands send</h3>
          <p className={styles.cardBody}>
            Browse a living archive of real emails — filtered by brand,
            category, market, and the platform that sent them.
          </p>
        </article>

        {/* Know why it works */}
        <article className={styles.card}>
          <div className={styles.cardVisual}>
            <div className={styles.bars}>
              <span className={styles.bar} style={{ height: "38%" }} />
              <span className={styles.bar} style={{ height: "64%" }} />
              <span
                className={`${styles.bar} ${styles.barAccent}`}
                style={{ height: "92%" }}
              />
              <span className={styles.bar} style={{ height: "52%" }} />
            </div>
          </div>
          <h3 className={styles.cardTitle}>Know why it works</h3>
          <p className={styles.cardBody}>
            Put brands side by side and read the patterns: send cadence, promo
            intensity, category mix, design tells, and the voice of their CTAs.
          </p>
        </article>

        {/* Make it yours */}
        <article className={styles.card}>
          <div className={styles.cardVisual}>
            <div className={styles.stack}>
              <span className={styles.stackCard} />
              <span className={styles.stackCard} />
              <span className={styles.stackCard} />
            </div>
          </div>
          <h3 className={styles.cardTitle}>Build your own swipe file</h3>
          <p className={styles.cardBody}>
            Save the emails worth keeping into collections, and follow the
            brands you want to watch — new sends land the moment they go out.
          </p>
        </article>
      </div>
    </section>
  );
}
