import type { Metadata } from "next";
import SiteHeader from "@/components/marketing/SiteHeader";
import FeatureExplainer from "@/components/marketing/FeatureExplainer";
import FeaturePoster from "@/components/marketing/FeaturePoster";
import { BrandDashboardVisual } from "@/components/marketing/feature-visuals";
import PricingTeaser from "@/components/marketing/PricingTeaser";
import SiteFooter from "@/components/marketing/SiteFooter";
import styles from "@/components/marketing/landing.module.css";

export const metadata: Metadata = {
  title: "Brand insights — Pirol",
  description:
    "See exactly how any brand runs email — send cadence, send hours, design DNA, discount depth, and stated offer deadlines, tracked from every campaign they send.",
};

export default function BrandsFeaturePage() {
  return (
    <main className={styles.page}>
      <SiteHeader />
      <FeatureExplainer
        eyebrow="Brand insights"
        title="Know exactly how a brand sends."
        lede="Pick any tracked brand and read its whole email playbook — when it sends, how it looks, and how deep its discounts really go."
        poster={
          <FeaturePoster>
            <BrandDashboardVisual />
          </FeaturePoster>
        }
        items={[
          {
            mark: "🗓️",
            title: "A year at a glance",
            body: "A send calendar coloured by campaign type — sales, launches, editorial — one square per day.",
          },
          {
            mark: "🕙",
            title: "Send hours",
            body: "Two clock faces show when the brand hits inboxes, down to the hour.",
          },
          {
            mark: "📈",
            title: "Cadence",
            body: "Emails per week over time, plus the typical gap between sends.",
          },
          {
            mark: "🎨",
            title: "Design DNA",
            body: "The brand's palette, fonts, GIF habits, dark-mode support, and image weight — extracted from the emails themselves.",
          },
          {
            mark: "🏷️",
            title: "Sale history",
            body: "Every discount at its stated depth, with the promised deadline — and whether the offer quietly ran past it.",
          },
          {
            mark: "💬",
            title: "Voice and habits",
            body: "Top CTAs, emoji use, subject length, and the campaign mix, so you can hear how the brand talks.",
          },
        ]}
      />
      <PricingTeaser />
      <SiteFooter />
    </main>
  );
}
