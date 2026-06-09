"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CollectionSummary } from "@/lib/collections-db";
import type { CompetitorSetSummary } from "@/lib/competitor-db";
import Logo from "@/components/Logo";
import styles from "./explore.module.css";

type NavId =
  | "explore"
  | "following"
  | "saved"
  | "brands"
  | "collections"
  | "compare";

type NavItem = {
  id: NavId;
  label: string;
  icon: React.ReactNode;
  href?: string;
};

type Props = {
  /**
   * Which nav row should render as selected. The sidebar is shared
   * across Explore (`/explore`), Saved (`/saved`), Brands, Collections,
   * and Compare; each page passes an explicit `activeId` so the
   * highlight tracks the page the user is actually on. A specific
   * collection id can also be passed in (e.g. `"collection:<uuid>"`)
   * so the matching row in the Collections section highlights. Same
   * trick for saved competitor sets via `"compare:<uuid>"`.
   */
  activeId?:
    | NavId
    | "settings"
    | `collection:${string}`
    | `compare:${string}`;
  /**
   * User's collections fetched server-side by the page. We render the
   * top few in the section and link "View all" to `/collections`.
   */
  collections?: CollectionSummary[];
  /**
   * User's saved competitor sets. Same shape as `collections`: server
   * fetches them once per page render and the sidebar renders the top
   * few with a "View all" link to `/compare`.
   */
  competitorSets?: CompetitorSetSummary[];
};

// Number of collection rows surfaced in the section before falling back
// to the "View all" link.
const COLLECTION_PREVIEW_COUNT = 5;
const COMPETITOR_SET_PREVIEW_COUNT = 5;

// Stable empty default for `collections`. Using a module-level constant
// (rather than an inline `= []` default) keeps the reference identical
// across renders, so the prop-mirror effect below doesn't fire on every
// render and cause an infinite update loop on pages that don't pass a
// `collections` prop (e.g. /brands).
const EMPTY_COLLECTIONS: CollectionSummary[] = [];
const EMPTY_COMPETITOR_SETS: CompetitorSetSummary[] = [];

function CompassIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <polygon points="14.5 9.5 9.5 11.5 9.5 14.5 14.5 12.5" />
    </svg>
  );
}

function HeartIcon() {
  // Outlined heart — same visual weight as the other 16px icons in
  // this column. Reads as "Following" without overlapping the bookmark
  // metaphor used by Saved.
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CompareIcon() {
  // Two overlapping circles — Venn-diagram shorthand for "compare".
  // Reads as distinct from the BrandsIcon (stacked layers) at the small
  // sidebar size.
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="12" r="6" />
      <circle cx="15" cy="12" r="6" />
    </svg>
  );
}

function BrandsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7l9-4 9 4-9 4z" />
      <path d="M3 12l9 4 9-4" />
      <path d="M3 17l9 4 9-4" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </svg>
  );
}

function CollectionIcon() {
  // Stacked layers — reads as "a curated set" rather than a filing folder,
  // matching the Collections rebrand away from the folder metaphor.
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="9" width="16" height="11" rx="2" />
      <path d="M6 6h12" />
      <path d="M8 3h8" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { id: "explore", label: "Explore", icon: <CompassIcon />, href: "/explore" },
  { id: "saved", label: "Saved", icon: <BookmarkIcon />, href: "/saved" },
  { id: "brands", label: "Brands", icon: <BrandsIcon />, href: "/brands" },
  {
    id: "following",
    label: "Following",
    icon: <HeartIcon />,
    href: "/following"
  },
  {
    id: "collections",
    label: "Collections",
    icon: <CollectionIcon />,
    href: "/collections"
  },
  { id: "compare", label: "Compare", icon: <CompareIcon />, href: "/compare" }
];

/**
 * Quiet utility controls ("Docs", "Need help?") rendered as a small
 * white panel that hangs down from the top-right of the viewport on
 * every app surface that mounts `ExploreSidebar`. Replaces the
 * earlier full-width Resend-style top bar — the panel is just wide
 * enough to wrap its two controls and leaves the rest of the top of
 * the page free. As the user scrolls down, the panel slides up out
 * of view (no opacity fade) so it doesn't sit on top of content.
 *
 * Styles are inline so the panel can't be broken by a stale
 * CSS-module mapping during dev hot-reloads.
 */
// Distance (in scroll px) over which the panel slides fully off-screen.
const APP_TOPBAR_COLLAPSE_DISTANCE = 120;

function AppTopBar() {
  const [hoverDocs, setHoverDocs] = useState(false);
  const [hoverHelp, setHoverHelp] = useState(false);
  // Tracks how far down the page the user has scrolled so the panel
  // can slide up (and eventually disable pointer events) without any
  // opacity change. We clamp to [0, 1] and apply the offset via an
  // inline `translateY` so the slide stays smooth.
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY || window.pageYOffset || 0;
      const next = Math.min(1, Math.max(0, y / APP_TOPBAR_COLLAPSE_DISTANCE));
      setScrollProgress(next);
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  // Roughly the panel's full height — translating by this much hides
  // it completely above the viewport while leaving its layout box in
  // place (it's `position: fixed`, so it can't push anything around).
  const COLLAPSED_OFFSET_PX = 64;
  const offset = -COLLAPSED_OFFSET_PX * scrollProgress;
  const pointerEvents = scrollProgress > 0.95 ? "none" : "auto";

  return (
    <div
      aria-label="App utilities"
      style={{
        position: "fixed",
        top: 0,
        right: "1.25rem",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: "0.55rem 0.7rem 0.7rem",
        background: "#ffffff",
        border: 0,
        borderBottomLeftRadius: 16,
        borderBottomRightRadius: 16,
        boxShadow: "var(--popover-shadow)",
        transform: `translateY(${offset}px)`,
        transition: "transform 220ms ease",
        pointerEvents,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
      }}
    >
      <Link
        href="/docs"
        onMouseEnter={() => setHoverDocs(true)}
        onMouseLeave={() => setHoverDocs(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          height: 30,
          padding: "0 0.65rem",
          borderRadius: 8,
          border: "1px solid transparent",
          background: hoverDocs ? "#f1f5f9" : "transparent",
          color: hoverDocs ? "#0f172a" : "#475569",
          fontSize: "0.83rem",
          fontWeight: 500,
          textDecoration: "none",
          cursor: "pointer",
          transition: "background 100ms ease, color 100ms ease"
        }}
      >
        Docs
      </Link>
      <button
        type="button"
        aria-label="Get help"
        onMouseEnter={() => setHoverHelp(true)}
        onMouseLeave={() => setHoverHelp(false)}
        onClick={() => {
          if (typeof window !== "undefined") {
            window.location.href = "mailto:help@pirol.app";
          }
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          height: 30,
          padding: "0 0.5rem 0 0.8rem",
          borderRadius: 999,
          border: 0,
          background: "#ffffff",
          color: hoverHelp ? "#0f172a" : "#475569",
          font: "inherit",
          fontSize: "0.83rem",
          fontWeight: 500,
          cursor: "pointer",
          boxShadow: hoverHelp
            ? "var(--pill-shadow-hover)"
            : "var(--pill-shadow)",
          transition: "color 100ms ease, box-shadow 0.15s ease"
        }}
      >
        <span>Need help?</span>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            borderRadius: 6,
            background: "#f1f5f9",
            color: "#475569",
            fontSize: "0.7rem",
            fontWeight: 600,
            letterSpacing: "-0.01em"
          }}
        >
          H
        </span>
      </button>
    </div>
  );
}

export default function ExploreSidebar({
  activeId = "explore",
  collections = EMPTY_COLLECTIONS,
  competitorSets = EMPTY_COMPETITOR_SETS
}: Props = {}) {
  const router = useRouter();
  const [items, setItems] = useState<CollectionSummary[]>(collections);
  const [sets, setSets] = useState<CompetitorSetSummary[]>(competitorSets);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createInputRef = useRef<HTMLInputElement | null>(null);

  // Keep local state in sync if the server re-renders the page with a
  // different list (e.g. after a route change).
  useEffect(() => {
    setItems(collections);
  }, [collections]);

  useEffect(() => {
    setSets(competitorSets);
  }, [competitorSets]);

  useEffect(() => {
    if (creating) {
      requestAnimationFrame(() => createInputRef.current?.focus());
    }
  }, [creating]);

  const activeCollectionId =
    typeof activeId === "string" && activeId.startsWith("collection:")
      ? activeId.slice("collection:".length)
      : null;
  const activeCompetitorSetId =
    typeof activeId === "string" && activeId.startsWith("compare:")
      ? activeId.slice("compare:".length)
      : null;
  const activeRowId: NavId = activeCollectionId
    ? "collections"
    : activeCompetitorSetId
      ? "compare"
      : (activeId as NavId);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = createName.trim();
    if (!name || createPending) return;
    setCreatePending(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const body = (await res.json()) as { collection: CollectionSummary };
      setItems((current) => [body.collection, ...current]);
      setCreateName("");
      setCreating(false);
      // Refresh the server-rendered shell so the Collections grid (if
      // the user is on it) and any other consumer see the new row.
      router.refresh();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create collection"
      );
    } finally {
      setCreatePending(false);
    }
  }

  return (
    <>
    <AppTopBar />
    <aside className={styles.sidebar} aria-label="Explore navigation">
      <div className={styles.brandRow}>
        <Logo className={styles.brandLogo} />
      </div>

      <div className={styles.navGroup}>
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === activeRowId;
          const className = `${styles.navItem}${
            isActive ? ` ${styles.active}` : ""
          }`;
          const ariaCurrent = isActive ? "page" : undefined;
          // Real navigable items get a Next.js Link; everything else
          // stays a button until it has a destination, so the sidebar
          // still demos as a full shell but unfinished rows aren't
          // keyboard-focusable.
          if (item.href) {
            return (
              <Link
                key={item.id}
                href={item.href}
                className={className}
                aria-current={ariaCurrent}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          }
          return (
            <button
              key={item.id}
              type="button"
              className={className}
              tabIndex={-1}
              aria-current={ariaCurrent}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.navGroup}>
        <div className={styles.sectionLabel}>
          <span>Your collections</span>
          <button
            type="button"
            className={styles.sectionAdd}
            aria-label="Create collection"
            onClick={() => setCreating((current) => !current)}
          >
            <PlusIcon />
          </button>
        </div>

        {creating ? (
          <form onSubmit={handleCreate} className={styles.sidebarCreateForm}>
            <input
              ref={createInputRef}
              type="text"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Collection name"
              maxLength={120}
              className={styles.sidebarCreateInput}
              aria-label="New collection name"
              disabled={createPending}
            />
            <div className={styles.sidebarCreateButtons}>
              <button
                type="button"
                className={styles.sidebarCreateCancel}
                onClick={() => {
                  setCreating(false);
                  setCreateName("");
                  setCreateError(null);
                }}
                disabled={createPending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.sidebarCreateSubmit}
                disabled={createPending || createName.trim().length === 0}
              >
                {createPending ? "Creating…" : "Create"}
              </button>
            </div>
            {createError ? (
              <div className={styles.sidebarCreateError} role="alert">
                {createError}
              </div>
            ) : null}
          </form>
        ) : null}

        {items.length === 0 && !creating ? (
          <div className={styles.sidebarEmpty}>
            No collections yet. Tap + to create one.
          </div>
        ) : null}

        {items.slice(0, COLLECTION_PREVIEW_COUNT).map((collection) => {
          const isActive = activeCollectionId === collection.id;
          const className = `${styles.navItem}${
            isActive ? ` ${styles.active}` : ""
          }`;
          return (
            <Link
              key={collection.id}
              href={`/collections/${collection.id}`}
              className={className}
              aria-current={isActive ? "page" : undefined}
              title={collection.name}
            >
              <span className={styles.navIcon}>
                {collection.icon ? (
                  <span className={styles.navEmoji} aria-hidden="true">
                    {collection.icon}
                  </span>
                ) : (
                  <CollectionIcon />
                )}
                {collection.hasNewEmails && !isActive ? (
                  <span
                    className={styles.navNewDot}
                    aria-label="New emails in this collection"
                  />
                ) : null}
              </span>
              <span className={styles.navItemLabel}>{collection.name}</span>
            </Link>
          );
        })}

        <Link href="/collections" className={styles.navItem}>
          <span className={styles.navIcon}>
            <MoreIcon />
          </span>
          <span>View all</span>
        </Link>
      </div>

      <div className={styles.navGroup}>
        <div className={styles.sectionLabel}>
          <span>Your competitors</span>
          <Link
            href="/compare"
            className={styles.sectionAdd}
            aria-label="Build a new comparison"
            title="Build a new comparison"
          >
            <PlusIcon />
          </Link>
        </div>

        {sets.length === 0 ? (
          <div className={styles.sidebarEmpty}>
            No saved sets yet. Open Compare to build one.
          </div>
        ) : null}

        {sets.slice(0, COMPETITOR_SET_PREVIEW_COUNT).map((set) => {
          const isActive = activeCompetitorSetId === set.id;
          const className = `${styles.navItem}${
            isActive ? ` ${styles.active}` : ""
          }`;
          return (
            <Link
              key={set.id}
              href={`/compare/${set.id}`}
              className={className}
              aria-current={isActive ? "page" : undefined}
              title={set.name}
            >
              <span className={styles.navIcon}>
                <CompareIcon />
              </span>
              <span className={styles.navItemLabel}>{set.name}</span>
            </Link>
          );
        })}

        {sets.length > 0 ? (
          <Link href="/compare" className={styles.navItem}>
            <span className={styles.navIcon}>
              <MoreIcon />
            </span>
            <span>View all</span>
          </Link>
        ) : null}
      </div>

      <div className={styles.spacer} />

      <div className={styles.usageCard}>
        <div className={styles.usageHeader}>
          <span className={styles.usageDot} aria-hidden="true" />
          <div className={styles.usageText}>
            18 emails saved this month
            <span className={styles.usageMuted}>Upgrade for unlimited use</span>
          </div>
        </div>
        <button type="button" className={styles.upgradeButton} tabIndex={-1}>
          Upgrade
        </button>
      </div>

      <Link
        href="/settings"
        className={`${styles.settingsRow}${
          activeId === "settings" ? ` ${styles.active}` : ""
        }`}
        aria-current={activeId === "settings" ? "page" : undefined}
      >
        <span>Settings</span>
        <span className={styles.navIcon}>
          <MoreIcon />
        </span>
      </Link>
    </aside>
    </>
  );
}
