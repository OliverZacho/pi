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
            mark: "📌",
            title: "Save anything",
            body: "Bookmark any email worth revisiting into a named collection.",
          },
          {
            mark: "⚙️",
            title: "Auto-collect by rule",
            body: "Set filters — search, category, brand, market, discount — and Pirol pulls every match, and keeps pulling as new emails land.",
          },
          {
            mark: "🔗",
            title: "Share with a link",
            body: "Send a read-only board to teammates or clients — no account needed to view it.",
          },
          {
            mark: "🗂️",
            title: "Build a swipe file",
            body: "Themed boards: “welcome series we love”, “Black Friday over 40%”, “best re-engagement”.",
          },
          {
            mark: "🔍",
            title: "Find it later",
            body: "Everything you save stays searchable and filterable across every brand.",
          },
          {
            mark: "👥",
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
