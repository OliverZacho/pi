"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import { UserMenu, type HeaderUser } from "@/components/marketing/Header";
import styles from "./docs.module.css";

const TABS = [
  { href: "/docs", label: "Docs" },
  { href: "/learn", label: "Learn" },
  { href: "/help", label: "Help" }
];

export default function DocsHeader({ user = null }: { user?: HeaderUser | null }) {
  const pathname = usePathname();

  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <Link href="/" className={styles.logo} aria-label="Pirol home">
          <Logo className={styles.logoMark} />
        </Link>

        <nav className={styles.tabs} aria-label="Documentation">
          {TABS.map((tab) => {
            const active =
              tab.href === "/docs"
                ? pathname.startsWith("/docs")
                : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={active ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                aria-current={active ? "page" : undefined}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className={styles.headerCenter}>
        <label className={styles.search}>
          <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Search docs…"
            aria-label="Search documentation"
          />
          <span className={styles.kbd}>⌘K</span>
        </label>
      </div>

      <div className={styles.headerRight}>
        <button type="button" className={styles.askAi}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          Ask AI
        </button>
        {user ? (
          <>
            <Link href="/explore" className={styles.primaryBtn}>
              Open app
            </Link>
            <UserMenu user={user} />
          </>
        ) : (
          <>
            <Link href="/login" className={styles.linkBtn}>
              Login
            </Link>
            <Link href="/login" className={styles.primaryBtn}>
              Sign up
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
