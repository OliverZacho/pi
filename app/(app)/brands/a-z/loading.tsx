import styles from "@/components/brand/brands-az.module.css";

/**
 * Matches the A to Z page's box: real breadcrumb and heading (static copy),
 * then placeholder rows where the letter groups land. Without this file the
 * parent `/brands` skeleton (toolbar + card grid) would flash first.
 */
export default function Loading() {
  return (
    <main className={styles.main}>
      <nav className={styles.breadcrumb} aria-hidden>
        <span>Brands</span>
        <span>/</span>
        <span>A to Z</span>
      </nav>
      <header className={styles.heading}>
        <h1>All brands A to Z</h1>
        <div className={styles.placeholderRow} style={{ width: "18rem" }} />
      </header>
      <div className={styles.group} aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className={styles.placeholderRow}
            style={{ width: `${8 + ((i * 5) % 7)}rem` }}
          />
        ))}
      </div>
    </main>
  );
}
