import colStyles from "@/components/collections/collections.module.css";
import shell from "./app-shell-skeleton.module.css";
import bars from "./detail-skeleton.module.css";

/**
 * Instant loading state for `/collections/[id]`. Breadcrumb + header
 * boxes reuse the page's own CSS module classes so the real header
 * streams in exactly on top of them; the grid mirrors Explore's email
 * cards via the shared shell-skeleton classes. The collection name is
 * dynamic, so every text slot is a shimmer bar, never placeholder copy.
 */
export default function CollectionDetailSkeleton() {
  return (
    <main className={shell.main} aria-hidden>
      <nav className={colStyles.breadcrumb}>
        <div className={bars.crumbBar} />
      </nav>

      <header className={colStyles.detailHeader}>
        <div className={colStyles.detailTitleGroup}>
          <div className={colStyles.detailTitleRow}>
            <div className={bars.titleIcon} />
            <div className={bars.titleBar} />
          </div>
          <div className={bars.metaBar} />
        </div>
        <div className={colStyles.detailActions}>
          <div className={bars.actionPill} />
          <div className={bars.actionPill} />
        </div>
      </header>

      <div className={`${shell.grid} ${shell.gridAfterToolbar}`}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={shell.card}>
            <div className={`${shell.cardPreview} ${shell.emailPreview}`} />
            <div className={shell.emailMeta}>
              <div className={shell.emailLineBrand} />
              <div className={shell.emailLineSubject} />
              <div className={shell.emailLineReceived} />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
