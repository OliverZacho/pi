import brandStyles from "@/components/brand/brand.module.css";
import shell from "./app-shell-skeleton.module.css";
import bars from "./detail-skeleton.module.css";

/**
 * Instant loading state for `/brands/[id]`. Breadcrumb, hero panel and
 * KPI grid reuse the dashboard's own CSS module classes so the real
 * header streams in exactly on top; the brand name / meta / stats are
 * dynamic, so all text slots are shimmer bars. Below the KPI row the
 * dashboard sections are data-sized (calendar, heatmap, charts), so the
 * panel stand-ins approximate rather than pixel-match.
 */
export default function BrandDetailSkeleton() {
  return (
    <main className={shell.main} aria-hidden>
      <nav className={brandStyles.breadcrumb}>
        <div className={bars.crumbBar} />
      </nav>

      <header className={brandStyles.hero}>
        <div className={brandStyles.heroIdentity}>
          <div className={bars.heroAvatar} />
          <div className={brandStyles.heroText}>
            <div className={bars.heroNameBar} />
            <div className={bars.heroMetaBar} />
          </div>
        </div>
        <div className={brandStyles.heroActions}>
          <div className={bars.actionPill} />
          <div className={bars.actionPill} />
        </div>
      </header>

      <section className={brandStyles.kpiGrid}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={brandStyles.kpiTile}>
            <div className={bars.kpiHeadBar} />
            <div className={bars.kpiValueBar} />
            <div className={bars.kpiHintBar} />
          </div>
        ))}
      </section>

      {[0, 1].map((i) => (
        <section key={i} className={brandStyles.recentSection}>
          <div className={bars.panelBlock}>
            <div className={bars.eyebrowBar} />
            <div className={bars.sectionTitleBar} />
            <div className={bars.sectionSubBar} />
          </div>
        </section>
      ))}
    </main>
  );
}
