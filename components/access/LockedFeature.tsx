import TrackedUpgradeLink from "@/components/common/TrackedUpgradeLink";
import styles from "./locked-feature.module.css";

export type LockedVariant =
  | "brand-stats"
  | "compare"
  | "collections"
  | "brands"
  | "following"
  | "saved";

type Copy = {
  eyebrow: string;
  title: string;
  description: string;
};

const COPY: Record<LockedVariant, Copy> = {
  "brand-stats": {
    eyebrow: "Brand analytics",
    title: "Unlock the full brand dashboard",
    description:
      "Send cadence, promo intensity, design DNA, subject-line and CTA analysis — the complete picture of how this brand runs its email program. Available on every paid plan."
  },
  compare: {
    eyebrow: "Comparisons",
    title: "Compare brands side by side",
    description:
      "Stack any brands against each other — cadence, promotions, send times and campaign mix in one dashboard. Subscribe to build and save your own comparisons."
  },
  collections: {
    eyebrow: "Collections",
    title: "Save and organize emails into collections",
    description:
      "Bookmark the emails worth revisiting, group them into shareable collections, and build your own swipe file. Subscribe to start collecting."
  },
  brands: {
    eyebrow: "Brands",
    title: "Browse every brand we track",
    description:
      "Search and filter the full directory of tracked brands, then open any one for its complete email analytics. Subscribe to explore the catalog."
  },
  following: {
    eyebrow: "Following",
    title: "Follow brands and build your feed",
    description:
      "Follow the brands you care about and get a focused feed of just their emails. Subscribe to start following."
  },
  saved: {
    eyebrow: "Saved",
    title: "Save emails to your gallery",
    description:
      "Bookmark any email and keep your own searchable gallery of the best work. Subscribe to start saving."
  }
};

type Props = {
  variant: LockedVariant;
  /** Optional overrides if a specific page wants different copy. */
  title?: string;
  description?: string;
};

/**
 * Clean "subscribe to unlock" panel shown to public (non-admin) users in
 * place of a gated feature. No real data is rendered behind it — the goal
 * is to communicate the value and route to `/pricing`.
 */
export default function LockedFeature({
  variant,
  title,
  description
}: Props) {
  const copy = COPY[variant];

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <span className={styles.lockBadge} aria-hidden="true">
          <LockIcon />
        </span>
        <span className={styles.eyebrow}>{copy.eyebrow}</span>
        <h2 className={styles.title}>{title ?? copy.title}</h2>
        <p className={styles.description}>{description ?? copy.description}</p>
        <TrackedUpgradeLink source={`locked_${variant.replace("-", "_")}`} className={styles.cta}>
          View plans
        </TrackedUpgradeLink>
        <span className={styles.footnote}>
          7-day money-back guarantee on every plan.
        </span>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
