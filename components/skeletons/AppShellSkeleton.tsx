import styles from "./app-shell-skeleton.module.css";

type Props = {
  /** Page title — rendered for real so it appears instantly, no shift. */
  title: string;
  /** Optional sub-heading line under the title. */
  subtitle?: string;
  /** How many shimmer cards to lay out in the grid. */
  cards?: number;
  /**
   * Render a placeholder search pill + filter chips + sort chip above the
   * grid, matching the real filter row's box exactly — pages that have a
   * toolbar must show it here too, or the grid jumps down when the real
   * page streams in.
   */
  toolbar?: boolean;
  /**
   * Card shape. "preview" is the bare preview square (generic default);
   * "email" adds the meta footer (brand / subject / received) under the
   * preview to mirror Explore's email cards; "brand" mirrors the shorter
   * brand stat card used by /brands. Matching the real card means it
   * lands exactly on top of its placeholder.
   */
  variant?: "preview" | "brand" | "email";
};

/** Varied chip widths so the placeholder row reads as distinct filters. */
const CHIP_WIDTHS = ["8.5rem", "5.2rem", "4.4rem", "6.4rem", "6.8rem"];

/**
 * Instant loading state for the app shell pages (Explore, Brands,
 * Collections, Comparisons). Rendered by each route's `loading.tsx` so
 * navigation paints immediately — a real title plus a grid of shimmering
 * cards — while the page's server fetch resolves and streams in behind
 * it. Only the main column: the sidebar lives in the shared `(app)`
 * layout, which persists across navigations, so the skeleton must not
 * render its own copy (that's what used to make the sidebar flash on
 * every page change).
 */
export default function AppShellSkeleton({
  title,
  subtitle,
  cards = 8,
  toolbar = false,
  variant = "preview"
}: Props) {
  return (
    <main className={styles.main}>
      <header className={styles.heading}>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>

      {toolbar ? (
        <div className={styles.toolbar} aria-hidden>
          <div className={styles.searchPill} />
          {CHIP_WIDTHS.map((width, i) => (
            <div key={i} className={styles.chip} style={{ width }} />
          ))}
          <div className={styles.sortPill} />
        </div>
      ) : null}

      <div
        className={`${styles.grid}${
          variant === "brand" ? ` ${styles.gridBrand}` : ""
        }${toolbar ? ` ${styles.gridAfterToolbar}` : ""}`}
        aria-hidden
      >
        {Array.from({ length: cards }).map((_, i) =>
          variant === "brand" ? (
            <div key={i} className={styles.brandCard}>
              <div className={styles.brandHead}>
                <div className={styles.brandAvatar} />
                <div className={styles.brandHeadText}>
                  <div className={styles.brandLine} />
                  <div className={styles.brandLineSub} />
                </div>
              </div>
              <div className={styles.brandStats}>
                <div className={styles.brandStat} />
                <div className={styles.brandStat} />
              </div>
              <div className={styles.brandFoot} />
            </div>
          ) : variant === "email" ? (
            <div key={i} className={styles.card}>
              <div className={`${styles.cardPreview} ${styles.emailPreview}`} />
              <div className={styles.emailMeta}>
                <div className={styles.emailLineBrand} />
                <div className={styles.emailLineSubject} />
                <div className={styles.emailLineReceived} />
              </div>
            </div>
          ) : (
            <div key={i} className={styles.card}>
              <div className={styles.cardPreview} />
            </div>
          )
        )}
      </div>
    </main>
  );
}
