import type { Metadata } from "next";
import SiteHeader from "@/components/marketing/SiteHeader";
import FeatureExplainer from "@/components/marketing/FeatureExplainer";
import PricingTeaser from "@/components/marketing/PricingTeaser";
import SiteFooter from "@/components/marketing/SiteFooter";
import styles from "@/components/marketing/landing.module.css";

export const metadata: Metadata = {
  title: "Comparisons — Pirol",
  description:
    "Put up to six brands side by side and read the patterns at a glance — send cadence, quiet zones, discount depth, seasonal moments, creative fingerprint, and what they talk about.",
};

export default function ComparisonsFeaturePage() {
  return (
    <main className={styles.page}>
      <SiteHeader />
      <FeatureExplainer
        eyebrow="Comparisons"
        title="Put up to six brands side by side."
        lede="Stack the brands you care about and read the patterns at a glance — who sends most, when they go quiet, how deep their discounts run, and what they actually talk about."
        items={[
          {
            mark: "⚡",
            title: "What's new",
            body: "Auto-flagged shifts — a brand spiking its volume, going quiet, or running its first sale in months.",
          },
          {
            mark: "📊",
            title: "KPI matrix",
            body: "Captured volume, average cadence, promo share, top ESP, subject length, emoji and urgency — every brand in one table.",
          },
          {
            mark: "🏁",
            title: "Who sends the most",
            body: "A send-rate league table — emails per week per brand, with trend arrows.",
          },
          {
            mark: "📈",
            title: "Send frequency over time",
            body: "Cadence charted from one week out to twelve months.",
          },
          {
            mark: "🕘",
            title: "When they send",
            body: "Each brand's day-and-hour send-time distribution, mapped.",
          },
          {
            mark: "🌙",
            title: "Quiet zones",
            body: "The day-parts nobody in the set is emailing — the gaps your campaign can own.",
          },
          {
            mark: "🏷️",
            title: "Discount aggressiveness",
            body: "Promo share and average discount depth, month by month.",
          },
          {
            mark: "🎯",
            title: "Seasonal moments",
            body: "Which holidays each brand activates, and how many days early they start.",
          },
          {
            mark: "🎨",
            title: "Creative fingerprint",
            body: "Palette, fonts, subject length, emoji and the voice of their CTAs — side by side.",
          },
        ]}
      />
      <PricingTeaser />
      <SiteFooter />
    </main>
  );
}
