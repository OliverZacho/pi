import styles from "./app-shell-skeleton.module.css";

type ToolbarOptions = {
  /** Filter-chip placeholders between search and sort. Default 5. */
  chips?: number;
  /** Render the right-aligned sort pill. Default true. */
  sort?: boolean;
};

type Props = {
  /** Page title — rendered for real so it appears instantly, no shift. */
  title: string;
  /** Optional sub-heading line under the title. */
  subtitle?: string;
  /**
   * Shimmer bar in the subtitle slot instead of text — for pages whose
   * subtitle is dynamic ("12 collections."), where static placeholder
   * copy would flash and then change.
   */
  subtitleBar?: boolean;
  /** How many shimmer cards to lay out in the grid. */
  cards?: number;
  /**
   * Render a placeholder search pill + filter chips + sort chip above the
   * grid, matching the real filter row's box exactly — pages that have a
   * toolbar must show it here too, or the grid jumps down when the real
   * page streams in. Pass an options object to drop pieces the page
   * doesn't have (e.g. `{ chips: 0 }` for Saved's search + sort row).
   */
  toolbar?: boolean | ToolbarOptions;
  /**
   * Render a pill-track placeholder between the heading and the toolbar,
   * matching the segmented Brands ⇄ Emails view toggle on /following.
   */
  viewToggle?: boolean;
  /**
   * Reserve the "N brands" result-count line between the toolbar and the
   * grid (/following shows one; /brands does not).
   */
  resultCount?: boolean;
  /**
   * Real section heading between the page heading and the grid, matching
   * /compare's "Your comparisons" section head (h2 + sub line).
   */
  section?: { title: string; subtitle?: string };
  /**
   * Dashed "new …" tile as the grid's first cell, matching the create
   * tiles on /collections and /compare.
   */
  newTile?: boolean;
  /**
   * Card shape. "preview" is the bare preview square (generic default);
   * "email" adds the meta footer (brand / subject / received) under the
   * preview to mirror Explore's email cards; "brand" mirrors the shorter
   * brand stat card used by /brands; "collection" and "comparison" are
   * the 2×2 mosaic tiles with a two- or three-line meta footer. Matching
   * the real card means it lands exactly on top of its placeholder.
   */
  variant?: "preview" | "brand" | "email" | "collection" | "comparison";
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
  subtitleBar = false,
  cards = 8,
  toolbar = false,
  viewToggle = false,
  resultCount = false,
  section,
  newTile = false,
  variant = "preview"
}: Props) {
  const toolbarOpts: ToolbarOptions | null = toolbar
    ? { chips: 5, sort: true, ...(toolbar === true ? {} : toolbar) }
    : null;

  const mosaicCard = (i: number, lines: 2 | 3) => (
    <div key={i} className={styles.card}>
      <div className={styles.mosaic}>
        <div className={styles.mosaicCell} />
        <div className={styles.mosaicCell} />
        <div className={styles.mosaicCell} />
        <div className={styles.mosaicCell} />
      </div>
      <div className={lines === 3 ? styles.mosaicMetaWide : styles.mosaicMeta}>
        <div className={styles.mosaicTitle} />
        <div className={styles.mosaicLine} />
        {lines === 3 ? <div className={styles.mosaicChip} /> : null}
      </div>
    </div>
  );

  return (
    <main className={styles.main}>
      <header className={styles.heading}>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
        {!subtitle && subtitleBar ? (
          <div className={styles.subtitleBar} aria-hidden />
        ) : null}
      </header>

      {viewToggle ? <div className={styles.viewToggle} aria-hidden /> : null}

      {toolbarOpts ? (
        <div className={styles.toolbar} aria-hidden>
          <div className={styles.searchPill} />
          {CHIP_WIDTHS.slice(0, toolbarOpts.chips).map((width, i) => (
            <div key={i} className={styles.chip} style={{ width }} />
          ))}
          {toolbarOpts.sort ? <div className={styles.sortPill} /> : null}
        </div>
      ) : null}

      {resultCount ? (
        <div className={styles.countLine} aria-hidden>
          <div className={styles.countBar} />
        </div>
      ) : null}

      {section ? (
        <div className={styles.sectionHead}>
          <div>
            <h2>{section.title}</h2>
            {section.subtitle ? <p>{section.subtitle}</p> : null}
          </div>
        </div>
      ) : null}

      <div
        className={`${styles.grid}${
          variant === "brand" ? ` ${styles.gridBrand}` : ""
        }${toolbarOpts ? ` ${styles.gridAfterToolbar}` : ""}${
          section ? ` ${styles.gridAfterSection}` : ""
        }`}
        aria-hidden
      >
        {newTile ? (
          <div className={styles.newTile}>
            <span className={styles.newTileIcon} />
            <span className={styles.newTileLabel} />
          </div>
        ) : null}
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
          ) : variant === "collection" ? (
            mosaicCard(i, 2)
          ) : variant === "comparison" ? (
            mosaicCard(i, 3)
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
