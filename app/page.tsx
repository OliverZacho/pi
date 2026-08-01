import SiteHeader from "@/components/marketing/SiteHeader";
import NewsletterFanHero from "@/components/marketing/NewsletterFanHero";
import HomeStory from "@/components/marketing/HomeStory";
import PricingTeaser from "@/components/marketing/PricingTeaser";
import SiteFooter from "@/components/marketing/SiteFooter";
import { siteStructuredData } from "@/lib/structured-data";
import { getArchiveStats } from "@/lib/marketing-stats";
import styles from "@/components/marketing/landing.module.css";

// Refresh the live archive numbers hourly.
export const revalidate = 3600;

export const metadata = {
  title: "Pirol — See how the best brands do email",
  description:
    "Pirol tracks how real brands run their email marketing. Browse a curated catalogue of newsletters, study what top senders do, and learn how to choose and run your email platform."
};

export default async function Home() {
  const stats = await getArchiveStats();

  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteStructuredData()) }}
      />
      <SiteHeader />
      <NewsletterFanHero />
      <HomeStory stats={stats} />
      <PricingTeaser />
      <SiteFooter />
    </main>
  );
}
