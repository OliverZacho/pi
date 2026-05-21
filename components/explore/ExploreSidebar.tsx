"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CollectionSummary } from "@/lib/collections-db";
import styles from "./explore.module.css";

type NavId =
  | "explore"
  | "saved"
  | "brands"
  | "collections"
  | "search"
  | "more";

type NavItem = {
  id: NavId;
  label: string;
  icon: React.ReactNode;
  href?: string;
};

type Props = {
  /**
   * Which nav row should render as selected. The sidebar is shared
   * across Explore (`/explore`), Saved (`/saved`), Brands, and
   * Collections; each page passes an explicit `activeId` so the
   * highlight tracks the page the user is actually on. A specific
   * collection id can also be passed in (e.g. `"collection:<uuid>"`)
   * so the matching row in the Collections section highlights.
   */
  activeId?: NavId | `collection:${string}`;
  /**
   * User's collections fetched server-side by the page. We render the
   * top few in the section and link "View all" to `/collections`.
   */
  collections?: CollectionSummary[];
};

// Number of collection rows surfaced in the section before falling back
// to the "View all" link.
const COLLECTION_PREVIEW_COUNT = 5;

// Stable empty default for `collections`. Using a module-level constant
// (rather than an inline `= []` default) keeps the reference identical
// across renders, so the prop-mirror effect below doesn't fire on every
// render and cause an infinite update loop on pages that don't pass a
// `collections` prop (e.g. /brands).
const EMPTY_COLLECTIONS: CollectionSummary[] = [];

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

function SearchIcon() {
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
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
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

function PanelToggleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { id: "explore", label: "Explore", icon: <CompassIcon />, href: "/explore" },
  { id: "saved", label: "Saved", icon: <BookmarkIcon />, href: "/saved" },
  { id: "brands", label: "Brands", icon: <BrandsIcon />, href: "/brands" },
  {
    id: "collections",
    label: "Collections",
    icon: <CollectionIcon />,
    href: "/collections"
  },
  { id: "search", label: "Search", icon: <SearchIcon /> },
  { id: "more", label: "More", icon: <MoreIcon /> }
];

export default function ExploreSidebar({
  activeId = "explore",
  collections = EMPTY_COLLECTIONS
}: Props = {}) {
  const router = useRouter();
  const [items, setItems] = useState<CollectionSummary[]>(collections);
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
    if (creating) {
      requestAnimationFrame(() => createInputRef.current?.focus());
    }
  }, [creating]);

  const activeCollectionId =
    typeof activeId === "string" && activeId.startsWith("collection:")
      ? activeId.slice("collection:".length)
      : null;
  const activeRowId = activeCollectionId ? "collections" : (activeId as NavId);

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
    <aside className={styles.sidebar} aria-label="Explore navigation">
      <div className={styles.brandRow}>
        <span className={styles.brandName}>Pirol</span>
        <button
          type="button"
          className={styles.brandToggle}
          aria-label="Toggle sidebar"
          tabIndex={-1}
        >
          <PanelToggleIcon />
        </button>
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
                <CollectionIcon />
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

      <div className={styles.settingsRow}>
        <span>Settings</span>
        <span className={styles.navIcon}>
          <MoreIcon />
        </span>
      </div>
    </aside>
  );
}
