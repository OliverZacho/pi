import cmpStyles from "@/components/compare/compare.module.css";
import shell from "./app-shell-skeleton.module.css";
import bars from "./detail-skeleton.module.css";

/**
 * Instant loading state for `/compare/[id]`. Breadcrumb, header panel
 * and section shells reuse the page's own CSS module classes so the
 * real dashboard streams in on top of them. The comparison name and
 * brand strip are dynamic, so all text slots are shimmer bars. Section
 * bodies are data-dependent (charts sized to the cohort), so below the
 * header this is an honest approximation, not a pixel match.
 */
export default function CompareDetailSkeleton() {
  return (
    <main className={shell.main} aria-hidden>
      <nav className={cmpStyles.breadcrumb}>
        <div className={bars.crumbBar} />
      </nav>

      <header className={cmpStyles.compareHeader}>
        <div className={cmpStyles.compareHeaderRow}>
          <div className={cmpStyles.compareTitle}>
            <div className={bars.cmpTitleBar} />
            <div className={bars.cmpSubBar} />
          </div>
          <div className={cmpStyles.compareActions}>
            <div className={bars.iconPill} />
            <div className={bars.iconPill} />
            <div className={bars.iconPill} />
          </div>
        </div>
        <div className={cmpStyles.brandStrip}>
          {["11rem", "9.5rem", "10.5rem", "8.5rem"].map((width, i) => (
            <div key={i} className={bars.stripPill} style={{ width }} />
          ))}
        </div>
      </header>

      {[0, 1].map((i) => (
        <section key={i} className={cmpStyles.section}>
          <div className={bars.eyebrowBar} />
          <div className={bars.sectionTitleBar} />
          <div className={bars.sectionSubBar} />
          <div className={bars.sectionContent} />
        </section>
      ))}
    </main>
  );
}
