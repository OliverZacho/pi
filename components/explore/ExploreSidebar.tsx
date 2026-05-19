import Link from "next/link";
import styles from "./explore.module.css";

type NavId = "explore" | "saved" | "boards" | "brands" | "search" | "more";

type NavItem = {
  id: NavId;
  label: string;
  icon: React.ReactNode;
  href?: string;
};

type Props = {
  /**
   * Which nav row should render as selected. The sidebar is shared
   * across the Explore grid (`/explore`) and the per-brand dashboards
   * (`/brands/[id]`); both pass an explicit `activeId` so the highlight
   * tracks the page the user is actually on.
   */
  activeId?: NavId;
};

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

function CollectionIcon() {
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
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
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

function FolderIcon() {
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
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
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
  { id: "saved", label: "Saved", icon: <BookmarkIcon /> },
  { id: "boards", label: "Boards", icon: <CollectionIcon /> },
  { id: "brands", label: "Brands", icon: <BrandsIcon /> },
  { id: "search", label: "Search", icon: <SearchIcon /> },
  { id: "more", label: "More", icon: <MoreIcon /> }
];

const FOLDERS: { id: string; label: string }[] = [
  { id: "demo", label: "Demo folder" }
];

export default function ExploreSidebar({ activeId = "explore" }: Props = {}) {
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
          const isActive = item.id === activeId;
          const className = `${styles.navItem}${
            isActive ? ` ${styles.active}` : ""
          }`;
          const ariaCurrent = isActive ? "page" : undefined;
          // Real navigable items (Explore today; Brands as we build it
          // out) get a Next.js Link; everything else stays a button until
          // it has a destination, so the sidebar still demos as a full
          // shell but unfinished rows aren't keyboard-focusable.
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
          <span>Folders</span>
          <button
            type="button"
            className={styles.sectionAdd}
            aria-label="Create folder"
            tabIndex={-1}
          >
            <PlusIcon />
          </button>
        </div>
        {FOLDERS.map((folder) => (
          <button
            key={folder.id}
            type="button"
            className={styles.navItem}
            tabIndex={-1}
          >
            <span className={styles.navIcon}>
              <FolderIcon />
            </span>
            <span>{folder.label}</span>
          </button>
        ))}
        <button type="button" className={styles.navItem} tabIndex={-1}>
          <span className={styles.navIcon}>
            <MoreIcon />
          </span>
          <span>View all</span>
        </button>
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
