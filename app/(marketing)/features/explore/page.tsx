import type { Metadata } from "next";
import SiteHeader from "@/components/marketing/SiteHeader";
import FeatureExplainer from "@/components/marketing/FeatureExplainer";
import FeaturePoster from "@/components/marketing/FeaturePoster";
import { LibraryShowcase } from "@/components/marketing/feature-visuals";
import PricingTeaser from "@/components/marketing/PricingTeaser";
import SiteFooter from "@/components/marketing/SiteFooter";
import styles from "@/components/marketing/landing.module.css";

export const metadata: Metadata = {
  title: "Explore the archive — Pirol",
  description:
    "Search thousands of real marketing emails from the brands worth watching. Filter by brand, category, content type, colour, GIF, or date — every email rendered exactly as it landed.",
};

export default function ExploreFeaturePage() {
  return (
    <main className={styles.page}>
      <SiteHeader />
      <FeatureExplainer
        eyebrow="The library"
        title="Thousands of newsletters, all searchable."
        lede="Every send from the brands worth watching, captured and rendered exactly as it landed in the inbox."
        poster={
          <FeaturePoster>
            <LibraryShowcase />
          </FeaturePoster>
        }
        items={[
          {
            mark: "🔍",
            title: "Search everything",
            body: "Full-text search across subjects and content, over the entire archive.",
          },
          {
            mark: "🎛️",
            title: "Filter precisely",
            body: "Narrow by brand, category, content type, sending period, GIFs, or dark-mode support.",
          },
          {
            mark: "🎨",
            title: "Search by colour",
            body: "Pick a swatch and see every email built around that colour.",
          },
          {
            mark: "📬",
            title: "As it landed",
            body: "Emails are real captures rendered pixel-for-pixel, not screenshots of screenshots.",
          },
          {
            mark: "⭐",
            title: "Start from the best",
            body: "A curated recommended feed surfaces standout sends first; switch to newest any time.",
          },
          {
            mark: "🔖",
            title: "Save the keepers",
            body: "Bookmark anything worth revisiting straight from the grid into your collections.",
          },
        ]}
      />
      <PricingTeaser />
      <SiteFooter />
    </main>
  );
}
