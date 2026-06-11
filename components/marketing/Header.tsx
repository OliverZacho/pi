"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import SearchOverlay from "./SearchOverlay";
import styles from "./landing.module.css";

/** Signed-in viewer for the header — display-only, resolved server-side. */
export type HeaderUser = {
  name: string | null;
  email: string;
};

/**
 * Initials for the avatar circle: first letters of the first and last
 * name words, falling back to the first letter of the email. No photo
 * uploads — the circle is always initials.
 */
function initials(user: HeaderUser): string {
  const name = user.name?.trim();
  if (name) {
    const words = name.split(/\s+/);
    const first = words[0]?.[0] ?? "";
    const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : "";
    return (first + last).toUpperCase();
  }
  return user.email[0]?.toUpperCase() ?? "?";
}

function UserMenu({ user }: { user: HeaderUser }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.userMenuWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.avatarBtn}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {initials(user)}
      </button>

      {open && (
        <div className={styles.userMenu} role="menu">
          <div className={styles.userMenuIdentity}>
            {user.name && <span className={styles.userMenuName}>{user.name}</span>}
            <span className={styles.userMenuEmail}>{user.email}</span>
          </div>
          <Link href="/saved" className={styles.userMenuItem} role="menuitem">
            Saved
          </Link>
          <Link href="/following" className={styles.userMenuItem} role="menuitem">
            Following
          </Link>
          <Link href="/settings" className={styles.userMenuItem} role="menuitem">
            Settings
          </Link>
          <form action="/auth/signout" method="post" className={styles.userMenuSignout}>
            <button type="submit" className={styles.userMenuItem} role="menuitem">
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

const SEARCH_HINTS = [
  "summer sale",
  "sustainability",
  "confirm your subscription",
  "midsummer",
  "activewear",
  "back in stock",
  "welcome series",
];

export default function Header({ user = null }: { user?: HeaderUser | null }) {
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

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
