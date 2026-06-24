import styles from "./app-shell-skeleton.module.css";

type Props = {
  /** Page title — rendered for real so it appears instantly, no shift. */
  title: string;
  /** Optional sub-heading line under the title. */
  subtitle?: string;
  /** How many shimmer cards to lay out in the grid. */
  cards?: number;
};

/**
 * Instant loading state for the app shell pages (Explore, Brands,
 * Collections, Comparisons). Rendered by each route's `loading.tsx` so
 * navigation paints immediately — a real title plus a sidebar placeholder
 * and a grid of shimmering cards — while the page's server fetch resolves
 * and streams in behind it.
 */
export default function AppShellSkeleton({
  title,
  subtitle,
  cards = 8
}: Props) {
  return (
    <div className={styles.shell}>
      <div className={styles.sidebar} aria-hidden />
      <main className={styles.main}>
        <header className={styles.heading}>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </header>
        <div className={styles.grid} aria-hidden>
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className={styles.card}>
              <div className={styles.cardPreview} />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
