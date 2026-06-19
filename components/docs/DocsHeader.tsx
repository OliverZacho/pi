"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import { UserMenu, type HeaderUser } from "@/components/marketing/Header";
import styles from "./docs.module.css";

const TABS = [
  { href: "/learn", label: "Learn" },
  { href: "/tutorials", label: "Tutorials" },
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
              tab.href === "/learn"
                ? pathname.startsWith("/learn")
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
            placeholder="Search…"
            aria-label="Search documentation"
          />
          <span className={styles.kbd}>⌘K</span>
        </label>
      </div>

      <div className={styles.headerRight}>
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
