import type { Metadata } from "next";
import SiteHeader from "@/components/marketing/SiteHeader";
import FeatureExplainer from "@/components/marketing/FeatureExplainer";
import FeaturePoster from "@/components/marketing/FeaturePoster";
import { FollowFeedVisual } from "@/components/marketing/feature-visuals";
import PricingTeaser from "@/components/marketing/PricingTeaser";
import SiteFooter from "@/components/marketing/SiteFooter";
import styles from "@/components/marketing/landing.module.css";

export const metadata: Metadata = {
  title: "Following — Pirol",
  description:
    "Follow the brands you care about and get a clean feed of just their emails — searchable, filterable, and ready to turn into a side-by-side comparison.",
};

export default function FollowingFeaturePage() {
  return (
    <main className={styles.page}>
      <SiteHeader />
      <FeatureExplainer
        eyebrow="Following"
        title="A feed of just the brands you care about."
        lede="Follow any brand in one click. Their new sends line up in a clean feed, without the noise of the whole archive."
        poster={
          <FeaturePoster>
            <FollowFeedVisual />
          </FeaturePoster>
        }
        items={[
          {
            mark: "➕",
            title: "Follow in one click",
            body: "Tap follow on any brand page or directory card and it joins your list.",
          },
          {
            mark: "📥",
            title: "Your own inbox",
            body: "The emails view is the full explore experience, scoped to only the brands you follow.",
          },
          {
            mark: "🔍",
            title: "Search within your follows",
            body: "Every filter — search, category, colour, dates — works inside your feed too.",
          },
          {
            mark: "🟢",
            title: "See who's active",
            body: "A green dot marks brands that have sent within the last two weeks.",
          },
          {
            mark: "⚖️",
            title: "Turn follows into a comparison",
            body: "Select a handful of followed brands and open them side by side in one click.",
          },
          {
            mark: "📊",
            title: "Jump to the deep dive",
            body: "Every card links straight to the brand's full insight dashboard.",
          },
        ]}
      />
      <PricingTeaser />
      <SiteFooter />
    </main>
  );
}
