"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import SearchOverlay from "./SearchOverlay";
import styles from "./landing.module.css";

const SEARCH_HINTS = [
  "summer sale",
  "sustainability",
  "confirm your subscription",
  "midsummer",
  "activewear",
  "back in stock",
  "welcome series",
];

export default function Header() {
  const [hint, setHint] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    // Pause the typewriter while the search overlay is open — a blurred,
    // constantly-changing hint in the background is distracting.
    if (searchOpen) return;

    let wordIndex = 0;
    let charCount = 0;
    let deleting = false;
    let timeout: number;

    const tick = () => {
      const word = SEARCH_HINTS[wordIndex];
      charCount += deleting ? -1 : 1;
      setHint(word.slice(0, charCount));

      let delay: number;
      if (!deleting && charCount === word.length) {
        // finished typing — hold, then start the "held backspace" delete
        deleting = true;
        delay = 1500;
      } else if (deleting && charCount === 0) {
        // fully deleted — move to the next word and type it out
        deleting = false;
        wordIndex = (wordIndex + 1) % SEARCH_HINTS.length;
        delay = 300;
      } else {
        // fast, even cadence while deleting = looks like a held backspace
        delay = deleting ? 35 : 95;
      }

      timeout = window.setTimeout(tick, delay);
    };

    timeout = window.setTimeout(tick, 600);
    return () => window.clearTimeout(timeout);
  }, [searchOpen]);

  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <Link href="#" className={styles.logo} aria-label="Pirol home">
          <Logo className={styles.logoMark} />
        </Link>

        <nav className={styles.navPill} aria-label="Primary">
          <Link href="/explore" className={styles.navLink}>
            Explore
          </Link>
          <Link href="/docs" className={styles.navLink}>
            Docs
          </Link>
          <Link href="/pricing" className={styles.navLink}>
            Pricing
          </Link>
        </nav>
      </div>

      <div className={styles.searchWrap}>
        <button
          type="button"
          className={styles.search}
          onClick={() => setSearchOpen(true)}
          aria-label="Open search"
        >
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
          <span className={styles.searchTrigger}>
            Try: {hint}
            <span className={styles.searchCaret}>|</span>
          </span>
          <span className={styles.searchPill}>Search</span>
        </button>
      </div>

      <div className={styles.headerRight}>
        <Link href="/login" className={styles.linkBtn}>
          Login
        </Link>
        <Link href="/login" className={styles.primaryBtn}>
          Sign up
        </Link>
      </div>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
