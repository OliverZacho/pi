import Link from "next/link";
import styles from "./landing.module.css";

export default function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <Link href="#" className={styles.logo} aria-label="Pirol home">
          <svg
            className={styles.logoMark}
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="8" cy="8" r="2" fill="currentColor" />
          </svg>
        </Link>

        <nav className={styles.navPill} aria-label="Primary">
          <Link href="#" className={styles.navLink}>
            Explore
          </Link>
          <Link href="#" className={styles.navLink}>
            Docs
          </Link>
          <Link href="#" className={styles.navLink}>
            Pricing
          </Link>
        </nav>
      </div>

      <div className={styles.searchWrap}>
        <div className={styles.search} role="search">
          <svg
            className={styles.searchIcon}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="m20 20-3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Try ‘luxury product packaging’"
            aria-label="Search"
            readOnly
          />
          <div className={styles.searchActions}>
            <button type="button" aria-label="Search by image">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect
                  x="3"
                  y="6"
                  width="18"
                  height="13"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <circle cx="12" cy="12.5" r="3.2" stroke="currentColor" strokeWidth="1.6" />
                <path
                  d="M8 6V4.8A.8.8 0 0 1 8.8 4h6.4a.8.8 0 0 1 .8.8V6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
              </svg>
            </button>
            <button type="button" aria-label="Ask AI">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className={styles.headerRight}>
        <Link href="#" className={styles.linkBtn}>
          Login
        </Link>
        <Link href="#" className={styles.primaryBtn}>
          Sign up
        </Link>
      </div>
    </header>
  );
}
