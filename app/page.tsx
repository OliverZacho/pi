import SiteHeader from "@/components/marketing/SiteHeader";
import NewsletterFanHero from "@/components/marketing/NewsletterFanHero";
import OutcomeBlocks from "@/components/marketing/OutcomeBlocks";
import BrandTeardown from "@/components/marketing/BrandTeardown";
import PricingTeaser from "@/components/marketing/PricingTeaser";
import SiteFooter from "@/components/marketing/SiteFooter";
import styles from "@/components/marketing/landing.module.css";

export const metadata = {
  title: "Pirol — See how the best brands do email",
  description:
    "Pirol tracks how real brands run their email marketing. Browse a curated catalogue of newsletters, study what top senders do, and learn how to choose and run your email platform."
};

export default function Home() {
  return (
    <main className={styles.page}>
      <SiteHeader />
      <NewsletterFanHero />
      <OutcomeBlocks />
      <BrandTeardown />
      <PricingTeaser />
      <SiteFooter />
    </main>
  );
}
