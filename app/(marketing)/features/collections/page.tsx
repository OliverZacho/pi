import type { Metadata } from "next";
import SiteHeader from "@/components/marketing/SiteHeader";
import FeatureExplainer from "@/components/marketing/FeatureExplainer";
import PricingTeaser from "@/components/marketing/PricingTeaser";
import SiteFooter from "@/components/marketing/SiteFooter";
import styles from "@/components/marketing/landing.module.css";

export const metadata: Metadata = {
  title: "Collections — Pirol",
  description:
    "Save the emails worth keeping, or set a rule and let Pirol gather every match across every brand into one living, shareable board.",
};

export default function CollectionsFeaturePage() {
  return (
    <main className={styles.page}>
      <SiteHeader />
      <FeatureExplainer
        eyebrow="Collections"
        title="A swipe file that fills itself."
        lede="Save the emails worth keeping, or set a rule and let Pirol gather every match across every brand into one living, shareable board."
        items={[
          {
            mark: <BookmarkIcon />,
            title: "Save anything",
            body: "Bookmark any email worth revisiting into a named collection.",
          },
          {
            mark: <SlidersIcon />,
            title: "Auto-collect by rule",
            body: "Set filters — search, category, brand, market, discount — and Pirol pulls every match, and keeps pulling as new emails land.",
          },
          {
            mark: <LinkIcon />,
            title: "Share with a link",
            body: "Send a read-only board to teammates or clients — no account needed to view it.",
          },
          {
            mark: <LayersIcon />,
            title: "Build a swipe file",
            body: "Themed boards: “welcome series we love”, “Black Friday over 40%”, “best re-engagement”.",
          },
          {
            mark: <SearchIcon />,
            title: "Find it later",
            body: "Everything you save stays searchable and filterable across every brand.",
          },
          {
            mark: <UsersIcon />,
            title: "Team collections",
            body: "On Team, collections are shared — your whole team builds one library together.",
          },
        ]}
      />
      <PricingTeaser />
      <SiteFooter />
    </main>
  );
}

const iconProps = {
  viewBox: "0 0 24 24",
  width: 18,
  height: 18,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function BookmarkIcon() {
  return (
    <svg {...iconProps}>
      <path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg {...iconProps}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="9" cy="7" r="2.4" fill="var(--surface, #fff)" />
      <circle cx="15" cy="17" r="2.4" fill="var(--surface, #fff)" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg {...iconProps}>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg {...iconProps}>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg {...iconProps}>
      <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" />
      <circle cx="10" cy="8" r="3.2" />
      <path d="M17 14a3.5 3.5 0 0 1 3 3.46V19" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" />
    </svg>
  );
}
