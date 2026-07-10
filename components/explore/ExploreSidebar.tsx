"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CollectionSummary } from "@/lib/collections-db";
import type { CompetitorSetSummary } from "@/lib/competitor-db";
import type { ViewerDisplay } from "@/lib/viewer-display";
import Logo from "@/components/Logo";
import BrandRequestModal from "@/components/brand/BrandRequestModal";
import FeatureRequestModal from "@/components/feedback/FeatureRequestModal";
import HelpPane from "@/components/help/HelpPane";
import BillingGraceCard from "@/components/billing/BillingGraceCard";
import SidebarNotices from "./SidebarNotices";
import styles from "./explore.module.css";

type NavId =
  | "explore"
  | "your-brand"
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

type ActiveId =
  | NavId
  | "settings"
  | `collection:${string}`
  | `compare:${string}`
  | null;

type Props = {
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
  /**
   * Whether the viewer is entitled (admin or active subscriber). Locked-out
   * viewers (logged-out or unpaid) don't own collections or competitor sets
   * and can't create them, so those management sections are hidden and the
   * usage card's CTA points at `/pricing` instead of the upgrade affordance.
   */
  hasAccess?: boolean;
  /**
   * Signed-in viewer's display identity (resolved server-side via
   * `getViewerDisplay`). When present, the sidebar footer renders the
   * account row + menu; when null/absent (logged-out preview) it falls
   * back to the plain Settings link.
   */
  user?: ViewerDisplay | null;
  /**
   * Name of the tracked brand whose website domain matches the viewer's
   * login-email domain, resolved server-side by the layout. When set,
   * a "Your brand" nav row appears (for unpaid viewers too — the page
   * itself shows a teaser); when null the row doesn't exist at all.
   */
  yourBrandName?: string | null;
};

// Number of collection/comparison rows surfaced in the collapsed section
// before the "View all" control. When a section holds fewer than
// SECTION_FOLD_OUT_LIMIT items, "View all" folds the rest open in place;
// at or above that count it falls back to linking to the full page.
const COLLECTION_PREVIEW_COUNT = 4;
const COMPETITOR_SET_PREVIEW_COUNT = 4;
const SECTION_FOLD_OUT_LIMIT = 10;

// Stable empty default for `collections`. Using a module-level constant
// (rather than an inline `= []` default) keeps the reference identical
// across renders, so the prop-mirror effect below doesn't fire on every
// render and cause an infinite update loop on pages that don't pass a
// `collections` prop (e.g. /brands).
const EMPTY_COLLECTIONS: CollectionSummary[] = [];
const EMPTY_COMPETITOR_SETS: CompetitorSetSummary[] = [];

/**
 * Which nav row should highlight, derived from the current URL. The
 * sidebar lives in the shared `(app)` layout (mounted once, persisting
 * across navigations), so it can't be told by each page which row is
 * active — it reads the pathname instead. Detail routes map to their
 * specific row (`/collections/<id>` → `collection:<id>`, `/compare/<id>`
 * → `compare:<id>`); brand detail pages keep the Brands row lit.
 */
function activeIdFromPathname(pathname: string | null): ActiveId {
  if (!pathname) return null;
  const [, first, second] = pathname.split("/");
  switch (first) {
    case "explore":
      return "explore";
    case "your-brand":
      return "your-brand";
    case "saved":
      return "saved";
    case "brands":
      return "brands";
    case "following":
      return "following";
    case "settings":
      return "settings";
    case "collections":
      return second ? `collection:${second}` : "collections";
    case "compare":
      return second ? `compare:${second}` : "compare";
    default:
      return null;
  }
}

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

function TeamIcon() {
  // Two-person silhouette — marks sidebar rows owned by a teammate
  // (shared with the team) rather than the viewer. Rendered at 12px so
  // it reads as a badge, not a second row icon.
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3.5 20v-1.5a5.5 5.5 0 0 1 11 0V20" />
      <path d="M16 5a3.5 3.5 0 0 1 0 6.8" />
      <path d="M17.8 13.4a5.5 5.5 0 0 1 2.7 5.1V20" />
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

function StorefrontIcon() {
  // Awning over a shop box — "your own storefront", distinct from the
  // stacked-layers Brands icon at the 16px sidebar size.
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
      <path d="M4 9l1.5-5h13L20 9" />
      <path d="M4 9a2.65 2.65 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.65 2.65 0 0 0 20 9" />
      <path d="M5.5 12.5V20h13v-7.5" />
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
  { id: "compare", label: "Comparisons", icon: <CompareIcon />, href: "/compare" }
];

/**
 * Quiet utility controls ("Learn", "Need help?") rendered as a small
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
        href="/learn"
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
        Learn
      </Link>
      <HelpPane variant="app" />
    </div>
  );
}

/**
 * Initials for the account avatar: first letters of the first and last
 * name words, falling back to the first letter of the email. Mirrors
 * the marketing header's avatar — always initials, no photo uploads.
 */
function initials(user: ViewerDisplay): string {
  const name = user.name?.trim();
  if (name) {
    const words = name.split(/\s+/);
    const first = words[0]?.[0] ?? "";
    const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : "";
    return (first + last).toUpperCase();
  }
  return user.email[0]?.toUpperCase() ?? "?";
}

/**
 * Account row pinned to the sidebar footer: initials avatar + name/email,
 * opening an upward menu (identity, Settings, Homepage, Docs, help,
 * Log out) in the style of Resend's / Anthropic Console's account areas.
 */
function AccountRow({
  user,
  settingsActive
}: {
  user: ViewerDisplay;
  settingsActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [featureRequestOpen, setFeatureRequestOpen] = useState(false);
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
    <div className={styles.accountWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.accountRow}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <span className={styles.accountAvatar} aria-hidden="true">
          {initials(user)}
        </span>
        <span className={styles.accountText}>
          {user.name ? (
            <span className={styles.accountName}>{user.name}</span>
          ) : null}
          <span className={styles.accountEmail}>{user.email}</span>
        </span>
        <span className={styles.navIcon}>
          <MoreIcon />
        </span>
      </button>

      {open && (
        <div className={styles.accountMenu} role="menu">
          <div className={styles.accountMenuIdentity}>
            {user.name ? (
              <span className={styles.accountMenuName}>{user.name}</span>
            ) : null}
            <span className={styles.accountMenuEmail}>{user.email}</span>
          </div>
          <Link
            href="/settings"
            className={`${styles.accountMenuItem}${
              settingsActive ? ` ${styles.active}` : ""
            }`}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
          <Link
            href="/"
            className={styles.accountMenuItem}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Homepage
          </Link>
          <button
            type="button"
            className={styles.accountMenuItem}
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setRequestOpen(true);
            }}
          >
            Request a brand
          </button>
          <button
            type="button"
            className={styles.accountMenuItem}
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setFeatureRequestOpen(true);
            }}
          >
            Request a feature
          </button>
          <form
            action="/auth/signout"
            method="post"
            className={styles.accountMenuSignout}
          >
            <button
              type="submit"
              className={styles.accountMenuItem}
              role="menuitem"
            >
              Log out
            </button>
          </form>
        </div>
      )}

      {requestOpen && (
        <BrandRequestModal onClose={() => setRequestOpen(false)} />
      )}

      {featureRequestOpen && (
        <FeatureRequestModal onClose={() => setFeatureRequestOpen(false)} />
      )}
    </div>
  );
}

export default function ExploreSidebar({
  collections = EMPTY_COLLECTIONS,
  competitorSets = EMPTY_COMPETITOR_SETS,
  hasAccess = true,
  user = null,
  yourBrandName = null
}: Props = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const activeId = activeIdFromPathname(pathname);
  const [items, setItems] = useState<CollectionSummary[]>(collections);
  const [sets, setSets] = useState<CompetitorSetSummary[]>(competitorSets);
  const [collectionsExpanded, setCollectionsExpanded] = useState(false);
  const [comparisonsExpanded, setComparisonsExpanded] = useState(false);
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
  const activeRowId: NavId | null = activeCollectionId
    ? "collections"
    : activeCompetitorSetId
      ? "compare"
      : (activeId as NavId | null);

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
      // Drop the user straight into the new collection so they can name
      // it, add emails, etc. The navigation re-renders the server shell,
      // so the sidebar + Collections grid pick up the new row too.
      router.push(`/collections/${body.collection.id}`);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create collection"
      );
    } finally {
      setCreatePending(false);
    }
  }

  // A section with fewer than SECTION_FOLD_OUT_LIMIT items folds open in
  // place via the "View all" toggle; at or above that count it keeps the
  // existing behaviour of linking out to the full page. Only the viewer's
  // own rows count toward the preview slice — team-shared rows (appended
  // by the layout, usually just a few) always render, otherwise a viewer
  // with 4+ collections of their own would never see them here.
  const ownCollections = items.filter((c) => !c.sharedByTeam);
  const teamCollections = items.filter((c) => c.sharedByTeam);
  const collectionsCanFoldOut = ownCollections.length < SECTION_FOLD_OUT_LIMIT;
  const collectionsAreExpanded = collectionsCanFoldOut && collectionsExpanded;
  const visibleCollections = [
    ...(collectionsAreExpanded
      ? ownCollections
      : ownCollections.slice(0, COLLECTION_PREVIEW_COUNT)),
    ...teamCollections
  ];
  const showCollectionsViewAll =
    ownCollections.length > COLLECTION_PREVIEW_COUNT;

  // "Your brand" only exists for viewers whose email domain matched a
  // tracked brand — inserted right after Explore so the personalized
  // surface sits at the top without reshuffling the familiar order.
  const navItems: NavItem[] = yourBrandName
    ? [
        NAV_ITEMS[0],
        {
          id: "your-brand",
          label: "Your brand",
          icon: <StorefrontIcon />,
          href: "/your-brand"
        },
        ...NAV_ITEMS.slice(1)
      ]
    : NAV_ITEMS;

  const ownSets = sets.filter((s) => !s.sharedByTeam);
  const teamSets = sets.filter((s) => s.sharedByTeam);
  const comparisonsCanFoldOut = ownSets.length < SECTION_FOLD_OUT_LIMIT;
  const comparisonsAreExpanded = comparisonsCanFoldOut && comparisonsExpanded;
  const visibleSets = [
    ...(comparisonsAreExpanded
      ? ownSets
      : ownSets.slice(0, COMPETITOR_SET_PREVIEW_COUNT)),
    ...teamSets
  ];
  const showComparisonsViewAll = ownSets.length > COMPETITOR_SET_PREVIEW_COUNT;

  return (
    <>
    <AppTopBar />
    {/* Failed-renewal nudge — self-fetches, only renders during a grace
        window. Gated on `user` so it never shows to logged-out previews. */}
    {user ? <BillingGraceCard /> : null}
    <aside className={styles.sidebar} aria-label="Explore navigation">
      <div className={styles.brandRow}>
        <Link href="/explore" aria-label="Pirol — go to Explore">
          <Logo className={styles.brandLogo} />
        </Link>
      </div>

      <div className={styles.navGroup}>
        {navItems.map((item) => {
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
                data-tour={`nav-${item.id}`}
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
              data-tour={`nav-${item.id}`}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {hasAccess ? (
        <>
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

        {visibleCollections.map((collection) => {
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
              {collection.sharedByTeam ? (
                <span
                  className={styles.navTeamBadge}
                  role="img"
                  aria-label={
                    collection.teamOwnerName
                      ? `Shared by ${collection.teamOwnerName}`
                      : "Shared with your team"
                  }
                  title={
                    collection.teamOwnerName
                      ? `Shared by ${collection.teamOwnerName}`
                      : "Shared with your team"
                  }
                >
                  <TeamIcon />
                </span>
              ) : null}
            </Link>
          );
        })}

        {showCollectionsViewAll ? (
          collectionsCanFoldOut ? (
            <button
              type="button"
              className={styles.navItem}
              onClick={() => setCollectionsExpanded((current) => !current)}
              aria-expanded={collectionsAreExpanded}
            >
              <span className={styles.navIcon}>
                <MoreIcon />
              </span>
              <span>{collectionsAreExpanded ? "Show less" : "View all"}</span>
            </button>
          ) : (
            <Link href="/collections" className={styles.navItem}>
              <span className={styles.navIcon}>
                <MoreIcon />
              </span>
              <span>View all</span>
            </Link>
          )
        ) : null}
      </div>

      <div className={styles.navGroup}>
        <div className={styles.sectionLabel}>
          <span>Your comparisons</span>
          <Link
            href="/compare#build"
            className={styles.sectionAdd}
            aria-label="Build a new comparison"
            title="Build a new comparison"
          >
            <PlusIcon />
          </Link>
        </div>

        {sets.length === 0 ? (
          <div className={styles.sidebarEmpty}>
            No comparisons yet. Select a few brands on the Brands page to
            start one.
          </div>
        ) : null}

        {visibleSets.map((set) => {
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
              {set.sharedByTeam ? (
                <span
                  className={styles.navTeamBadge}
                  role="img"
                  aria-label={
                    set.teamOwnerName
                      ? `Shared by ${set.teamOwnerName}`
                      : "Shared with your team"
                  }
                  title={
                    set.teamOwnerName
                      ? `Shared by ${set.teamOwnerName}`
                      : "Shared with your team"
                  }
                >
                  <TeamIcon />
                </span>
              ) : null}
            </Link>
          );
        })}

        {showComparisonsViewAll ? (
          comparisonsCanFoldOut ? (
            <button
              type="button"
              className={styles.navItem}
              onClick={() => setComparisonsExpanded((current) => !current)}
              aria-expanded={comparisonsAreExpanded}
            >
              <span className={styles.navIcon}>
                <MoreIcon />
              </span>
              <span>{comparisonsAreExpanded ? "Show less" : "View all"}</span>
            </button>
          ) : (
            <Link href="/compare" className={styles.navItem}>
              <span className={styles.navIcon}>
                <MoreIcon />
              </span>
              <span>View all</span>
            </Link>
          )
        ) : null}
      </div>
        </>
      ) : null}

      <div className={styles.spacer} />

      <div className={styles.sidebarFooter}>
        <SidebarNotices signedIn={Boolean(user)} />

        {user ? (
          <AccountRow user={user} settingsActive={activeId === "settings"} />
        ) : (
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
        )}
      </div>
    </aside>
    </>
  );
}
